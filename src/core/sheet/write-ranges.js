import { parseXml, applyEdits, attributeEdit } from '../xml.js';
import { readRelationships } from '../opc.js';
import { parseRange, parseCellRef, readUsedGrid } from '../cells.js';
import { QuoinError } from '../errors.js';
import { MAX_ROWS, MAX_COLS } from '../export/limits.js';
import { tableCellRows } from './sheet-xml.js';
import { expectedGrid, sameGrid, sameCell } from './grid.js';
import { appendStyles } from './styles.js';

export const rectOf = (write) => ({ r1: write.anchor.row, c1: write.anchor.col, r2: write.anchor.row + write.table.rowCount, c2: write.anchor.col + write.table.columns.length - 1 });
export const intersects = (a, b) => a.r1 <= b.r2 && b.r1 <= a.r2 && a.c1 <= b.c2 && b.c1 <= a.c2;
const inside = (rect, r, c) => r >= rect.r1 && r <= rect.r2 && c >= rect.c1 && c <= rect.c2;
const refRect = (ref) => parseRange(ref);
const worksheetOf = (wb, name) => wb.sheets.find((s) => s.type === 'worksheet' && s.part && s.name === name);

async function readSheet(pkg, part) {
  const text = await pkg.text(part);
  const doc = parseXml(text.text, part);
  const sheetData = doc.root.child('sheetData');
  return { text, doc, sheetData };
}

function layoutProblem(sheetData) {
  if (!sheetData || sheetData.name.includes(':')) return true;
  if (sheetData.selfClosing) return false;
  for (const row of sheetData.children) {
    if (row.name !== 'row' || row.attr('r') === null || row.attr('r') === undefined) return true;
    for (const cell of row.children) if (cell.name !== 'c' || !cell.attr('r') || !parseCellRef(cell.attr('r'))) return true;
  }
  return false;
}

export async function refuseReason(wb, write) {
  const sheet = worksheetOf(wb, write.sheet);
  if (!sheet) return 'refused.noSheet';
  if (!write.table.columns.length) return 'refused.empty';
  const rect = rectOf(write);
  if (rect.r1 < 0 || rect.c1 < 0 || rect.r2 > MAX_ROWS - 1 || rect.c2 > MAX_COLS - 1) return 'refused.outOfSheet';
  for (const table of wb.tables) {
    if (table.sheet !== write.sheet) continue;
    const t = refRect(table.ref);
    if (t && intersects(rect, t)) return 'refused.overlapsTable';
  }
  const { doc, sheetData } = await readSheet(wb.pkg, sheet.part);
  if (layoutProblem(sheetData)) return 'refused.unsupportedSheet';
  const merges = doc.root.child('mergeCells');
  if (merges) for (const m of merges.childrenNamed('mergeCell')) {
    const r = refRect(m.attr('ref') || '');
    if (r && intersects(rect, r)) return 'refused.overlapsMerge';
  }
  if (!sheetData.selfClosing) {
    for (const row of sheetData.childrenNamed('row')) {
      const rn = Number(row.attr('r')) - 1;
      if (rn < rect.r1 || rn > rect.r2) continue;
      for (const cell of row.childrenNamed('c')) {
        const ref = parseCellRef(cell.attr('r'));
        if (ref.col >= rect.c1 && ref.col <= rect.c2 && cell.child('f')) return 'refused.overlapsFormula';
      }
    }
  }
  return null;
}

function cellColumn(cell) {
  return parseCellRef(cell.attr('r')).col;
}

function rebuildSheet(text, doc, sheetData, writes, styles) {
  const source = text.text;
  const rectangles = writes.map(rectOf);
  for (let i = 0; i < rectangles.length; i++) for (let j = i + 1; j < rectangles.length; j++) if (intersects(rectangles[i], rectangles[j])) throw new TypeError('ranges written to one sheet overlap');
  const fresh = new Map();
  for (const write of writes) {
    for (const { row, cells } of tableCellRows(write.table, write.culture || 'en-US', styles, write.anchor.row, write.anchor.col)) {
      if (!fresh.has(row)) fresh.set(row, new Map());
      for (const cell of cells) fresh.get(row).set(cell.col, cell.xml);
    }
  }
  const existing = sheetData.selfClosing ? [] : sheetData.childrenNamed('row');
  const byNumber = new Map(existing.map((r) => [Number(r.attr('r')), r]));
  const rowNumbers = [...fresh.keys()].sort((a, b) => a - b);
  const newRows = [];
  const edits = [];
  const prefixes = new Map();
  for (const rn of rowNumbers) {
    const added = fresh.get(rn);
    const row = byNumber.get(rn);
    if (!row) {
      newRows.push({ rn, xml: `<row r="${rn}">${[...added.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]).join('')}</row>` });
      continue;
    }
    const kept = row.childrenNamed('c').filter((c) => !added.has(cellColumn(c))).map((c) => [cellColumn(c), source.slice(c.start, c.end)]);
    const all = [...kept, ...added.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]).join('');
    const open = source.slice(row.start, row.openEnd).replace(/\s*\/>$/, '>').replace(/\s+spans="[^"]*"/, '');
    edits.push({ start: row.start, end: row.end, replacement: `${open}${all}</row>` });
  }
  if (sheetData.selfClosing) edits.push({ start: sheetData.start, end: sheetData.end, replacement: `<sheetData>${newRows.map((r) => r.xml).join('')}</sheetData>` });
  else {
    for (const row of newRows) {
      const next = existing.find((e) => Number(e.attr('r')) > row.rn);
      const at = next ? next.start : sheetData.closeStart;
      prefixes.set(at, `${prefixes.get(at) || ''}${row.xml}`);
    }
    for (const [at, xml] of prefixes) {
      const hit = edits.find((e) => e.start === at);
      if (hit) hit.replacement = xml + hit.replacement;
      else edits.push({ start: at, end: at, replacement: xml });
    }
  }
  const dimension = doc.root.child('dimension');
  if (dimension && dimension.attr('ref')) {
    const old = refRect(dimension.attr('ref'));
    const all = rectangles.reduce((u, r) => ({ r1: Math.min(u.r1, r.r1), c1: Math.min(u.c1, r.c1), r2: Math.max(u.r2, r.r2), c2: Math.max(u.c2, r.c2) }), old || rectangles[0]);
    const colName = (i) => { let n = i + 1; let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
    edits.push(attributeEdit(dimension, 'ref', `${colName(all.c1)}${all.r1 + 1}:${colName(all.c2)}${all.r2 + 1}`));
  }
  return applyEdits(source, edits);
}

export async function writeRangesToPackage(wb, pkg, writes) {
  const touched = new Set();
  const rels = await readRelationships(pkg, wb.workbookPart);
  const added = await appendStyles(pkg, rels);
  touched.add(added.part);
  const bySheet = new Map();
  for (const write of writes) {
    const sheet = worksheetOf(wb, write.sheet);
    if (!sheet) throw new TypeError(`no such sheet: ${write.sheet}`);
    if (!bySheet.has(sheet.part)) bySheet.set(sheet.part, []);
    bySheet.get(sheet.part).push(write);
  }
  for (const [part, list] of bySheet) {
    const { text, doc, sheetData } = await readSheet(pkg, part);
    if (layoutProblem(sheetData)) throw new QuoinError('check.part', 'sheet cannot take cells', part);
    await pkg.setText(part, rebuildSheet(text, doc, sheetData, list, added.ids), text);
    touched.add(part);
  }
  return { touched, addedParts: new Set() };
}

export async function verifyWrittenRanges(back, wb, writes) {
  const names = [...new Set(writes.map((w) => w.sheet))];
  for (const name of names) {
    const list = writes.filter((w) => w.sheet === name);
    const before = await readUsedGrid(wb, name);
    const after = await readUsedGrid(back, name);
    for (const write of list) {
      const rect = rectOf(write);
      const slice = after.slice(rect.r1, rect.r2 + 1).map((row) => row.slice(rect.c1, rect.c2 + 1));
      if (!sameGrid(expectedGrid(write.table, write.culture || 'en-US'), slice)) throw new QuoinError('check.part', 'range differs after write', name);
    }
    const rects = list.map(rectOf);
    const rows = Math.max(before.length, after.length);
    for (let r = 0; r < rows; r++) {
      const width = Math.max((before[r] || []).length, (after[r] || []).length);
      for (let c = 0; c < width; c++) {
        if (rects.some((rect) => inside(rect, r, c))) continue;
        if (!sameCell((before[r] || [])[c], (after[r] || [])[c])) throw new QuoinError('check.part', 'cells outside the range changed', name);
      }
    }
  }
}
