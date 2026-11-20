import { kindOf } from '../m/values.js';
import { getCulture } from '../m/culture.js';
import { cellValue, serialOf, exportText } from '../export/cells.js';
import { MAX_ROWS, MAX_COLS } from '../export/limits.js';

export const MAX_CELL_TEXT = 32767;

const TICKS_PER_DAY = 864000000000;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

export function snapshotCell(raw, culture) {
  const cv = cellValue(raw);
  if (!cv.ok) return { t: 'e', v: '#VALUE!' };
  const v = cv.v;
  switch (kindOf(v)) {
    case 'null':
      return null;
    case 'number':
      return Number.isFinite(v) ? { t: 'n', v } : { t: 'e', v: '#NUM!' };
    case 'logical':
      return { t: 'b', v };
    case 'date':
    case 'datetime':
    case 'datetimezone':
    case 'time':
      return { t: 'dt', v: serialOf(v) };
    case 'duration':
      return { t: 'dur', v: Number(v.ticks) / TICKS_PER_DAY };
    default:
      return { t: 's', v: exportText(v, culture) };
  }
}

export function tableCells(table, cultureName) {
  const culture = getCulture(cultureName);
  const rows = [];
  for (let r = 0; r < table.rowCount; r++) rows.push(table.cols.map((col) => snapshotCell(col[r], culture)));
  return rows;
}

const clean = (cell) => (cell && cell.t === 's' ? { t: 's', v: cell.v.replace(CONTROL, '') } : cell);

export function expectedGrid(table, cultureName) {
  const header = table.columns.map((name) => ({ t: 's', v: name }));
  return [header, ...tableCells(table, cultureName)].map((row) => row.map(clean));
}

function sameCell(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return (a === null || a === undefined) && (b === null || b === undefined);
  return a.t === b.t && Object.is(a.v, b.v);
}

export function sameGrid(want, got) {
  if (want.length !== got.length) return false;
  for (let r = 0; r < want.length; r++) {
    for (let c = 0; c < want[r].length; c++) if (!sameCell(want[r][c], got[r] ? got[r][c] : undefined)) return false;
  }
  return true;
}

export const tooLarge = (table) => table.columns.length > MAX_COLS || table.rowCount > MAX_ROWS - 1;

export function hasLongText(grid) {
  for (const row of grid) for (const cell of row) if (cell && cell.t === 's' && [...cell.v].length > MAX_CELL_TEXT) return true;
  return false;
}
