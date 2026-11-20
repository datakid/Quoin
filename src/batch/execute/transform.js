import { QuoinError } from '../../core/errors.js';
import { openWorkbook } from '../../core/workbook.js';
import { readUsedGrid } from '../../core/cells.js';
import { tableToXlsx } from '../../core/export/xlsx.js';
import { NameBook } from '../../core/sheet/names.js';
import { expectedGrid, hasLongText, sameGrid, tooLarge } from '../../core/sheet/grid.js';
import { sha256Bytes } from '../index/hash.js';
import { reportRow } from './changes.js';
import { zipClock } from './collect.js';
import { runFileUnits } from './units.js';

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
  return { settled, outputs, bytes: null, sha256: null };
}

async function writeNewSheets(wb, items, culture, apply) {
  const settled = new Map();
  if (!items.length) return { settled, outputs: [], bytes: null, sha256: null };
  const book = new NameBook({ sheets: wb.sheets.map((s) => s.name) });
  const adds = items.map(({ run, action }) => ({ run, name: book.sheet(action.output.name || SHEET), table: run.table, culture }));
  let written;
  try {
    written = await apply({ sheets: { add: adds.map(({ name, table, culture: c }) => ({ name, table, culture: c })) } });
  } catch (e) {
    if (!(e instanceof QuoinError)) throw e;
    const verdict = e.code === 'write.selfcheck' ? 'not-released' : 'failed';
    for (const { run } of adds) settled.set(run, { verdict, reason_code: e.code, verified: false });
    return { settled, outputs: [], bytes: null, sha256: null };
  }
  const sha256 = await sha256Bytes(written.bytes);
  for (const { run, name } of adds) settled.set(run, { verdict: 'changed', reason_code: '', verified: true, output: `${written.name} [${name}]`, new_hash: sha256 });
  return { settled, outputs: [{ unit: null, name: written.name, bytes: written.bytes, sha256 }], bytes: written.bytes, sha256 };
}

export async function executeTransform(wb, filePlan, recipe, { now, meta, runId = '', apply } = {}) {
  if (recipe.compute === 'excel') throw new Error('excel compute is not supported yet');
  if (!recipe.output) throw new TypeError('a transform recipe needs an output');
  const mode = recipe.output.mode;
  if (mode !== 'newFile' && mode !== 'newSheet') throw new Error(`${mode} output is not supported yet`);
  if (mode === 'newSheet' && typeof apply !== 'function') throw new TypeError('a new sheet output needs the change writer');
  const started = performance.now();
  const file = meta || { name: wb.fileName, relPath: wb.fileName };
  const warnings = wb.warnings.map((w) => (w.part ? { code: w.code, part: w.part } : { code: w.code }));
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
  const written = mode === 'newFile' ? await writeNewFiles(items, culture, zipClock(now)) : await writeNewSheets(wb, items, culture, apply);
  const rows = runs.map((run) => {
    const action = filePlan.actions.find((a) => a.unit.index === run.unit.index);
    const settled = early.get(run) || written.settled.get(run);
    return reportRow(file, action, recipe, { run_id: runId, ...settled, duration_ms: Math.round(performance.now() - started) });
  });
  return { fileId: filePlan.fileId, outputs: written.outputs, bytes: written.bytes, sha256: written.sha256, rows, failures, warnings };
}
