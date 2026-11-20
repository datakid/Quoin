import { openWorkbook } from '../../core/workbook.js';
import { readUsedGrid } from '../../core/cells.js';
import { tableToXlsx, MAX_ROWS, MAX_COLS } from '../../core/export/xlsx.js';
import { sha256Bytes } from '../index/hash.js';
import { reportRow } from './changes.js';
import { zipClock } from './collect.js';
import { runFileUnits, tableCells } from './units.js';

const MAX_CELL_TEXT = 32767;
const SHEET = 'Result';
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

const clean = (cell) => (cell && cell.t === 's' ? { t: 's', v: cell.v.replace(CONTROL, '') } : cell);

function expectedGrid(table, culture) {
  const header = table.columns.map((name) => ({ t: 's', v: name }));
  return [header, ...tableCells(table, culture)].map((row) => row.map(clean));
}

function sameCell(a, b) {
  if (a === null || b === null || a === undefined || b === undefined) return (a === null || a === undefined) && (b === null || b === undefined);
  return a.t === b.t && Object.is(a.v, b.v);
}

function sameGrid(want, got) {
  if (want.length !== got.length) return false;
  for (let r = 0; r < want.length; r++) {
    for (let c = 0; c < want[r].length; c++) if (!sameCell(want[r][c], got[r] ? got[r][c] : undefined)) return false;
  }
  return true;
}

function tooLarge(table) {
  return table.columns.length > MAX_COLS || table.rowCount > MAX_ROWS - 1;
}

function hasLongText(grid) {
  for (const row of grid) for (const cell of row) if (cell && cell.t === 's' && [...cell.v].length > MAX_CELL_TEXT) return true;
  return false;
}

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

async function newFileFor(run, action, culture, clock) {
  const grid = expectedGrid(run.table, culture);
  if (tooLarge(run.table)) return { verdict: 'refused', reason_code: 'refused.tooLarge', verified: false };
  if (hasLongText(grid)) return { verdict: 'refused', reason_code: 'refused.cellTooLong', verified: false };
  const bytes = await tableToXlsx(run.table, culture, { now: clock });
  if (!(await readsBack(bytes, grid))) return { verdict: 'not-released', reason_code: 'verify.readBack', verified: false };
  return { verdict: 'changed', reason_code: '', verified: true, output: { unit: run.unit, name: action.output.name, bytes, sha256: await sha256Bytes(bytes) } };
}

export async function executeTransform(wb, filePlan, recipe, { now, meta, runId = '' } = {}) {
  if (recipe.compute === 'excel') throw new Error('excel compute is not supported yet');
  if (!recipe.output) throw new TypeError('a transform recipe needs an output');
  if (recipe.output.mode !== 'newFile') throw new Error(`${recipe.output.mode} output is not supported yet`);
  const started = performance.now();
  const file = meta || { name: wb.fileName, relPath: wb.fileName };
  const warnings = wb.warnings.map((w) => (w.part ? { code: w.code, part: w.part } : { code: w.code }));
  const { runs } = await runFileUnits(wb, file, filePlan, recipe, { now });
  const clock = zipClock(now);
  const outputs = [];
  const failures = [];
  const rows = [];
  for (const run of runs) {
    const action = filePlan.actions.find((a) => a.unit.index === run.unit.index);
    let settled;
    if (run.status !== 'ok') {
      failures.push({ unit: run.unit, m: run.m, error: run.error });
      settled = { verdict: 'failed', reason_code: run.error.code, reason: failureReason(run.error), verified: false };
    } else {
      const made = await newFileFor(run, action, recipe.more.culture, clock);
      settled = { verdict: made.verdict, reason_code: made.reason_code, verified: made.verified };
      if (made.output) {
        outputs.push(made.output);
        settled.output = made.output.name;
        settled.new_hash = made.output.sha256;
      }
    }
    rows.push(reportRow(file, action, recipe, { run_id: runId, ...settled, duration_ms: Math.round(performance.now() - started) }));
  }
  return { fileId: filePlan.fileId, outputs, rows, failures, warnings };
}
