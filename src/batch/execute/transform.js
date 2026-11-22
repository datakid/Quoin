import { QuoinError } from '../../core/errors.js';
import { openWorkbook } from '../../core/workbook.js';
import { readUsedGrid } from '../../core/cells.js';
import { tableToXlsx, workbookFromSheets, STANDARD_STYLES } from '../../core/export/xlsx.js';
import { sheetXml } from '../../core/sheet/sheet-xml.js';
import { NameBook } from '../../core/sheet/names.js';
import { refuseReason, rectOf, intersects } from '../../core/sheet/write-ranges.js';
import { parseCellRef, indexToCol } from '../../core/cells.js';
import { expectedGrid, hasLongText, sameGrid, tooLarge } from '../../core/sheet/grid.js';
import { sha256Bytes } from '../index/hash.js';
import { reportRow } from './changes.js';
import { zipClock } from './collect.js';
import { gridDigest } from './combine.js';
import { runFileUnits } from './units.js';
import { executeOnOpen } from './excel-compute.js';

const SHEET = 'Result';

async function readsBack(bytes, want) {
  try {
    const back = await openWorkbook(bytes, 'output.xlsx');
    return sameGrid(want, await readUsedGrid(back, SHEET));
  } catch {
    return false;
  }
}

const failureReason = (error) => {
  if (error.code === 'unit.parse') return `${error.message} (line ${error.line}, column ${error.col})`;
  return error.message || (error.detail === undefined || error.detail === null ? '' : String(error.detail));
};

const refusal = (reason_code) => ({ refusal: { verdict: 'refused', reason_code, verified: false } });

function fitsASheet(table, culture) {
  if (tooLarge(table)) return refusal('refused.tooLarge');
  const grid = expectedGrid(table, culture);
  if (hasLongText(grid)) return refusal('refused.cellTooLong');
  return { grid };
}

async function writeNewFiles(items, culture, clock) {
  const settled = new Map();
  const outputs = [];
  for (const { run, action, grid } of items) {
    const bytes = await tableToXlsx(run.table, culture, { now: clock });
    if (!(await readsBack(bytes, grid))) {
      settled.set(run, { verdict: 'not-released', reason_code: 'verify.readBack', verified: false });
      continue;
    }
    const output = { unit: run.unit, name: action.output.name, bytes, sha256: await sha256Bytes(bytes) };
    outputs.push(output);
    settled.set(run, { verdict: 'changed', reason_code: '', verified: true, output: output.name, new_hash: output.sha256 });
  }
  return { settled, outputs, bytes: null, sha256: null, sheetParts: [] };
}

async function writeSheetParts(items, culture, clock, runs) {
  const settled = new Map();
  const sheetParts = [];
  for (const { run, action, grid } of items) {
    const xml = sheetXml(run.table, culture, STANDARD_STYLES);
    const alone = await workbookFromSheets([{ name: SHEET, xml }], { now: clock });
    if (!(await readsBack(alone, grid))) {
      settled.set(run, { verdict: 'not-released', reason_code: 'verify.readBack', verified: false });
      continue;
    }
    settled.set(run, { verdict: 'changed', reason_code: '', verified: true, output: '', new_hash: '' });
    sheetParts.push({ unit: run.unit, name: action.output.name || run.unit.name, xml, digest: await gridDigest(grid), rowIndex: runs.indexOf(run), columns: run.table.columns.length, rows: run.table.rowCount });
  }
  return { settled, outputs: [], bytes: null, sha256: null, sheetParts };
}

function anchorOf(range) {
  const parts = range.replace(/\$/g, '').split(':');
  const a = parseCellRef(parts[0]);
  const b = parts.length > 1 ? parseCellRef(parts[1]) : null;
  const anchor = { row: b ? Math.min(a.row, b.row) : a.row, col: b ? Math.min(a.col, b.col) : a.col };
  return { anchor, limit: b ? { rows: Math.abs(a.row - b.row) + 1, cols: Math.abs(a.col - b.col) + 1 } : null };
}

const sheetFor = (wb, unit) => (unit.kind === 'sheet' ? unit.name : (wb.tables.find((t) => t.displayName === unit.name || t.name === unit.name) || {}).sheet);

const rangeText = (rect) => `${indexToCol(rect.c1)}${rect.r1 + 1}:${indexToCol(rect.c2)}${rect.r2 + 1}`;

async function writeInPlace(wb, items, recipe, culture, apply) {
  const settled = new Map();
  const accepted = [];
  const { anchor, limit } = anchorOf(recipe.output.range);
  for (const { run } of items) {
    const sheet = sheetFor(wb, run.unit);
    const write = { sheet, anchor, table: run.table, culture };
    let reason = null;
    if (limit && (run.table.rowCount + 1 > limit.rows || run.table.columns.length > limit.cols)) reason = 'refused.rangeTooSmall';
    else if (!sheet) reason = 'refused.noSheet';
    else reason = await refuseReason(wb, write);
    if (!reason && accepted.some((a) => a.write.sheet === sheet && intersects(rectOf(a.write), rectOf(write)))) reason = 'refused.overlap';
    if (reason) settled.set(run, { verdict: 'refused', reason_code: reason, verified: false });
    else accepted.push({ run, write });
  }
  if (!accepted.length) return { settled, outputs: [], bytes: null, sha256: null, sheetParts: [] };
  let written;
  try {
    written = await apply({ sheets: { write: accepted.map((a) => a.write) } });
  } catch (e) {
    if (!(e instanceof QuoinError)) throw e;
    const verdict = e.code === 'write.selfcheck' ? 'not-released' : 'failed';
    for (const { run } of accepted) settled.set(run, { verdict, reason_code: e.code, verified: false });
    return { settled, outputs: [], bytes: null, sha256: null, sheetParts: [] };
  }
  const sha256 = await sha256Bytes(written.bytes);
  for (const { run, write } of accepted) settled.set(run, { verdict: 'changed', reason_code: '', verified: true, output: `${written.name} [${write.sheet}!${rangeText(rectOf(write))}]`, new_hash: sha256 });
  return { settled, outputs: [{ unit: null, name: written.name, bytes: written.bytes, sha256 }], bytes: written.bytes, sha256, sheetParts: [] };
}

async function writeNewSheets(wb, items, culture, apply) {
  const settled = new Map();
  if (!items.length) return { settled, outputs: [], bytes: null, sha256: null, sheetParts: [] };
  const book = new NameBook({ sheets: wb.sheets.map((s) => s.name) });
  const adds = items.map(({ run, action }) => ({ run, name: book.sheet(action.output.name || SHEET), table: run.table, culture }));
  let written;
  try {
    written = await apply({ sheets: { add: adds.map(({ name, table, culture: c }) => ({ name, table, culture: c })) } });
  } catch (e) {
    if (!(e instanceof QuoinError)) throw e;
    const verdict = e.code === 'write.selfcheck' ? 'not-released' : 'failed';
    for (const { run } of adds) settled.set(run, { verdict, reason_code: e.code, verified: false });
    return { settled, outputs: [], bytes: null, sha256: null, sheetParts: [] };
  }
  const sha256 = await sha256Bytes(written.bytes);
  for (const { run, name } of adds) settled.set(run, { verdict: 'changed', reason_code: '', verified: true, output: `${written.name} [${name}]`, new_hash: sha256 });
  return { settled, outputs: [{ unit: null, name: written.name, bytes: written.bytes, sha256 }], bytes: written.bytes, sha256, sheetParts: [] };
}

export async function executeTransform(wb, filePlan, recipe, { now, meta, runId = '', apply, allowInPlace = false } = {}) {
  if (recipe.compute === 'excel') return executeOnOpen(wb, filePlan, recipe, { meta, runId, apply });
  if (!recipe.output) throw new TypeError('a transform recipe needs an output');
  const mode = recipe.output.mode;
  if (mode !== 'newFile' && mode !== 'newSheet' && mode !== 'combined' && mode !== 'inPlace') throw new Error(`${mode} output is not supported yet`);
  if ((mode === 'newSheet' || mode === 'inPlace') && typeof apply !== 'function') throw new TypeError('a new sheet output needs the change writer');
  const started = performance.now();
  const file = meta || { name: wb.fileName, relPath: wb.fileName };
  const warnings = wb.warnings.map((w) => (w.part ? { code: w.code, part: w.part } : { code: w.code }));
  if (mode === 'inPlace' && !allowInPlace) {
    const rows = filePlan.actions.map((action) => reportRow(file, action, recipe, { run_id: runId, verdict: 'refused', reason_code: 'refused.inPlaceHeld', verified: false, duration_ms: Math.round(performance.now() - started) }));
    return { fileId: filePlan.fileId, outputs: [], bytes: null, sha256: null, sheetParts: [], rows, failures: [], warnings };
  }
  const culture = recipe.more.culture;
  const { runs } = await runFileUnits(wb, file, filePlan, recipe, { now });
  const failures = [];
  const early = new Map();
  const items = [];
  for (const run of runs) {
    const action = filePlan.actions.find((a) => a.unit.index === run.unit.index);
    if (run.status !== 'ok') {
      failures.push({ unit: run.unit, m: run.m, error: run.error });
      early.set(run, { verdict: 'failed', reason_code: run.error.code, reason: failureReason(run.error), verified: false });
      continue;
    }
    const fits = fitsASheet(run.table, culture);
    if (fits.refusal) early.set(run, fits.refusal);
    else items.push({ run, action, grid: fits.grid });
  }
  const clock = zipClock(now);
  const written = mode === 'newFile' ? await writeNewFiles(items, culture, clock) : mode === 'combined' ? await writeSheetParts(items, culture, clock, runs) : mode === 'inPlace' ? await writeInPlace(wb, items, recipe, culture, apply) : await writeNewSheets(wb, items, culture, apply);
  const rows = runs.map((run) => {
    const action = filePlan.actions.find((a) => a.unit.index === run.unit.index);
    const settled = early.get(run) || written.settled.get(run);
    return reportRow(file, action, recipe, { run_id: runId, ...settled, duration_ms: Math.round(performance.now() - started) });
  });
  return { fileId: filePlan.fileId, outputs: written.outputs, bytes: written.bytes, sha256: written.sha256, sheetParts: written.sheetParts, rows, failures, warnings };
}
