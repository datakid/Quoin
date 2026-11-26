import { openWorkbook } from '../../core/workbook.js';
import { readUsedGrid } from '../../core/cells.js';
import { workbookFromSheets } from '../../core/export/xlsx.js';
import { NameBook } from '../../core/sheet/names.js';
import { normalisedRows } from '../../core/sheet/grid.js';
import { sha256Bytes, sha256Text } from '../index/hash.js';
import { sheetOutput } from './changes.js';

export const gridDigest = (grid) => sha256Text(JSON.stringify(normalisedRows(grid)));

async function readsBackAs(bytes, name, parts) {
  try {
    const back = await openWorkbook(bytes, 'combined.xlsx');
    if (JSON.stringify(back.sheets.map((s) => s.name)) !== JSON.stringify(parts.map((p) => p.name))) return false;
    for (const p of parts) if ((await gridDigest(await readUsedGrid(back, p.name))) !== p.part.digest) return false;
    return true;
  } catch {
    return false;
  }
}

function patch(results, parts, change) {
  const touched = new Map();
  for (const p of parts) {
    if (!touched.has(p.resultIndex)) touched.set(p.resultIndex, results[p.resultIndex].rows.slice());
    const rows = touched.get(p.resultIndex);
    rows[p.part.rowIndex] = { ...rows[p.part.rowIndex], ...change(p) };
  }
  return results.map((r, i) => ({ ...r, rows: touched.get(i) || r.rows }));
}

export const COMBINED_NAME = 'Combined.xlsx';

function partsOf(results) {
  const book = new NameBook();
  const parts = [];
  results.forEach((result, resultIndex) => {
    for (const part of result.sheetParts) parts.push({ resultIndex, part, name: book.sheet(part.name) });
  });
  return parts;
}

export function labelCombined(results, name = COMBINED_NAME) {
  return patch(results, partsOf(results), (p) => ({ output: sheetOutput(name, p.name) }));
}

export async function combineOutputs(results, { now, name = COMBINED_NAME } = {}) {
  const parts = partsOf(results);
  if (!parts.length) return { bytes: null, sha256: null, name, sheetNames: [], results };
  const bytes = await workbookFromSheets(parts.map((p) => ({ name: p.name, xml: p.part.xml })), { now });
  if (!(await readsBackAs(bytes, name, parts))) {
    return { bytes: null, sha256: null, name, sheetNames: [], results: patch(results, parts, () => ({ verdict: 'not-released', reason_code: 'verify.readBack', verified: false, output: '', new_hash: '' })) };
  }
  const sha256 = await sha256Bytes(bytes);
  return { bytes, sha256, name, sheetNames: parts.map((p) => p.name), results: patch(results, parts, (p) => ({ output: sheetOutput(name, p.name), new_hash: sha256, verified: true })) };
}
