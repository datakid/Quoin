import test from 'node:test';
import assert from 'node:assert/strict';
import { openWorkbook } from '../../src/core/workbook.js';
import { readUsedGrid } from '../../src/core/cells.js';
import { applyChangeSet, emptyChangeSet } from '../../src/core/save.js';
import { runOnce } from '../../src/core/m/engine.js';
import { expectedGrid } from '../../src/core/sheet/grid.js';
import { writeRangesToPackage, refuseReason, verifyWrittenRanges } from '../../src/core/sheet/write-ranges.js';
import { QuoinError } from '../../src/core/errors.js';
import { fixture } from './helpers.js';

const NOW = new Date('2026-11-14T10:00:00Z');
const open = (name) => openWorkbook(fixture(name), name);
const tableOf = (m) => runOnce({ sectionText: `section Section1;\r\n\r\nshared Result =\r\n${m};`, queryName: 'Result', now: '2026-11-14T10:00:00.000Z', previewRows: 1 }).value;
const SMALL = '#table({"Name", "Score"}, {{"Ann", 1}, {"Bob", 2.5}})';
const TYPED = '#table({"D","DT","T","Span","Flag","Num","Txt","Nil","Err"}, {{#date(2026, 11, 14), #datetime(2026, 11, 14, 10, 30, 15), #time(8, 15, 0), #duration(1, 2, 0, 0), true, 1.5, "x & <y>", null, error "no"}})';
const write = (sheet, anchor, m = SMALL) => ({ sheet, anchor, table: tableOf(m), culture: 'en-US' });
const changeSet = (...writes) => {
  const cs = emptyChangeSet();
  cs.sheets.write.push(...writes);
  return cs;
};
const saved = async (name, cs) => {
  const wb = await open(name);
  const out = await applyChangeSet(wb, cs, { now: NOW });
  return { wb, out, back: await openWorkbook(out.bytes, name) };
};
const cellsAt = (grid, row, col, h, w) => grid.slice(row, row + h).map((r) => Array.from({ length: w }, (_, i) => r[col + i] || null));

const SYNTH_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
const synthetic = async (wb, body, tail = '') => {
  const pkg = wb.pkg.clone();
  const part = wb.sheets[0].part;
  await pkg.setText(part, `${SYNTH_HEAD}<dimension ref="A1:B7"/><sheetData>${body}</sheetData>${tail}</worksheet>`, await pkg.text(part));
  return { pkg, part };
};

test('a table written at an anchor lands there and the cells around it are untouched', async () => {
  const { wb, back } = await saved('pq_simple.xlsx', changeSet(write('Input', { row: 0, col: 4 })));
  const before = await readUsedGrid(wb, 'Input');
  const after = await readUsedGrid(back, 'Input');
  assert.deepEqual(cellsAt(after, 0, 4, 3, 2), expectedGrid(tableOf(SMALL), 'en-US'));
  assert.deepEqual(cellsAt(after, 0, 0, before.length, 2), cellsAt(before, 0, 0, before.length, 2));
});

test('only the sheet part, the styles and nothing else differ', async () => {
  const { wb, out } = await saved('pq_simple.xlsx', changeSet(write('Input', { row: 0, col: 4 })));
  const back = await openWorkbook(out.bytes, 'x.xlsx');
  const before = new Map(wb.pkg.zip.entries.map((e) => [e.name, e.crc32]));
  const changed = back.pkg.zip.entries.filter((e) => before.get(e.name) !== e.crc32).map((e) => e.name).sort();
  assert.deepEqual(changed, ['xl/styles.xml', 'xl/worksheets/sheet1.xml']);
  assert.equal(back.pkg.zip.entries.length, wb.pkg.zip.entries.length);
});

test('the queries, tables and the other sheets are as they were', async () => {
  const { wb, back } = await saved('pq_simple.xlsx', changeSet(write('Input', { row: 0, col: 4 })));
  assert.deepEqual(back.queries.map((q) => q.original), wb.queries.map((q) => q.original));
  assert.deepEqual(back.tables.map((t) => [t.name, t.ref]), wb.tables.map((t) => [t.name, t.ref]));
  assert.deepEqual(await readUsedGrid(back, 'StudentResults'), await readUsedGrid(wb, 'StudentResults'));
});

test('typed values come back typed with the date styles appended to the workbook styles', async () => {
  const { back } = await saved('pq_simple.xlsx', changeSet(write('Input', { row: 9, col: 0 }, TYPED)));
  const grid = await readUsedGrid(back, 'Input');
  assert.deepEqual(cellsAt(grid, 9, 0, 2, 9), expectedGrid(tableOf(TYPED), 'en-US'));
});

test('the dimension of the sheet grows to cover the new cells', async () => {
  const { back } = await saved('pq_simple.xlsx', changeSet(write('Input', { row: 0, col: 4 })));
  assert.match((await back.pkg.text('xl/worksheets/sheet1.xml')).text, /<dimension ref="A1:F4"\/>/);
});

test('cells are merged into existing rows in column order, new rows land between and after the existing ones, and stale spans are dropped', async () => {
  const wb = await open('pq_simple.xlsx');
  const { pkg, part } = await synthetic(wb, '<row r="1" spans="1:2"><c r="A1"><v>1</v></c><c r="F1"><v>6</v></c></row><row r="3" spans="1:1"><c r="A3"><v>3</v></c></row><row r="5"/><row r="7"><c r="A7"><v>7</v></c></row>');
  await writeRangesToPackage(wb, pkg, [write('Input', { row: 0, col: 2 }, '#table({"X","Y"}, {{1,2},{3,4},{5,6},{7,8},{9,10},{11,12}})')]);
  const text = (await pkg.text(part)).text;
  const rows = [...text.matchAll(/<row r="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(rows, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(text.includes('spans='), false);
  assert.match(text, /<row r="1"><c r="A1"><v>1<\/v><\/c><c r="C1"[^>]*>.*?<\/c><c r="D1"[^>]*>.*?<\/c><c r="F1"><v>6<\/v><\/c><\/row>/);
  assert.match(text, /<row r="7"><c r="A7"><v>7<\/v><\/c><c r="C7"><v>11<\/v><\/c><c r="D7"><v>12<\/v><\/c><\/row>/);
});

test('an empty sheetData takes the rows', async () => {
  const wb = await open('pq_simple.xlsx');
  const pkg = wb.pkg.clone();
  const part = wb.sheets[0].part;
  await pkg.setText(part, `${SYNTH_HEAD}<sheetData/></worksheet>`, await pkg.text(part));
  await writeRangesToPackage(wb, pkg, [write('Input', { row: 1, col: 1 })]);
  const text = (await pkg.text(part)).text;
  assert.match(text, /<sheetData><row r="2">.*<\/row><row r="3">.*<\/row><row r="4">.*<\/row><\/sheetData>/);
});

test('values already in the range are replaced', async () => {
  const wb = await open('pq_simple.xlsx');
  const { pkg, part } = await synthetic(wb, '<row r="1"><c r="A1" t="inlineStr"><is><t>old</t></is></c><c r="B1"><v>9</v></c></row>');
  await writeRangesToPackage(wb, pkg, [write('Input', { row: 0, col: 0 })]);
  const text = (await pkg.text(part)).text;
  assert.equal(text.includes('old'), false);
  assert.match(text, /<c r="A1"[^>]*t="inlineStr"[^>]*><is><t>Name<\/t><\/is><\/c>/);
});

test('a range over a table is refused, and so is one that touches a merged range or a formula', async () => {
  const plain = await open('plain_table.xlsx');
  assert.equal(await refuseReason(plain, write('Toy Group Scores', { row: 1, col: 3 })), 'refused.overlapsTable');
  assert.equal(await refuseReason(plain, write('Toy Group Scores', { row: 0, col: 8 })), null);
  const wb = await open('pq_simple.xlsx');
  const merged = await synthetic(wb, '<row r="1"><c r="A1"><v>1</v></c></row>', '<mergeCells count="1"><mergeCell ref="D1:E2"/></mergeCells>');
  wb.pkg = merged.pkg;
  assert.equal(await refuseReason(wb, write('Input', { row: 0, col: 3 })), 'refused.overlapsMerge');
  assert.equal(await refuseReason(wb, write('Input', { row: 0, col: 5 })), null);
  const withFormula = await synthetic(await open('pq_simple.xlsx'), '<row r="2"><c r="E2"><f>SUM(A1:A2)</f><v>3</v></c></row>');
  const fw = await open('pq_simple.xlsx');
  fw.pkg = withFormula.pkg;
  assert.equal(await refuseReason(fw, write('Input', { row: 0, col: 4 })), 'refused.overlapsFormula');
  assert.equal(await refuseReason(fw, write('Input', { row: 0, col: 6 })), null);
});

test('a missing sheet and a range off the end of the sheet are refused', async () => {
  const wb = await open('pq_simple.xlsx');
  assert.equal(await refuseReason(wb, write('Nope', { row: 0, col: 0 })), 'refused.noSheet');
  assert.equal(await refuseReason(wb, write('Input', { row: 0, col: 16383 })), 'refused.outOfSheet');
  assert.equal(await refuseReason(wb, write('Input', { row: 1048575, col: 0 })), 'refused.outOfSheet');
});

test('a sheet with rows or cells that carry no position is refused, not guessed', async () => {
  const wb = await open('pq_simple.xlsx');
  const odd = await synthetic(wb, '<row><c><v>1</v></c></row>');
  wb.pkg = odd.pkg;
  assert.equal(await refuseReason(wb, write('Input', { row: 0, col: 5 })), 'refused.unsupportedSheet');
});

test('two ranges on different sheets and two on one sheet are all written', async () => {
  const { back } = await saved('pq_simple.xlsx', changeSet(write('Input', { row: 0, col: 4 }), write('Input', { row: 6, col: 4 }), write('StudentResults', { row: 0, col: 5 })));
  const input = await readUsedGrid(back, 'Input');
  assert.deepEqual(cellsAt(input, 0, 4, 3, 2), expectedGrid(tableOf(SMALL), 'en-US'));
  assert.deepEqual(cellsAt(input, 6, 4, 3, 2), expectedGrid(tableOf(SMALL), 'en-US'));
  assert.deepEqual(cellsAt(await readUsedGrid(back, 'StudentResults'), 0, 5, 3, 2), expectedGrid(tableOf(SMALL), 'en-US'));
});

test('a macro workbook keeps its VBA project byte for byte', async () => {
  const wb = await open('pq_vba_complex.xlsm');
  const out = await applyChangeSet(wb, changeSet(write('Input', { row: 0, col: 10 })), { now: NOW });
  const back = await openWorkbook(out.bytes, 'm.xlsm');
  assert.equal(back.pkg.zip.get(wb.vba.part).crc32, wb.pkg.zip.get(wb.vba.part).crc32);
  assert.deepEqual(back.vba.project.modules.map((m) => m.text), wb.vba.project.modules.map((m) => m.text));
});

test('the same change set written twice gives the same bytes', async () => {
  const a = await saved('pq_simple.xlsx', changeSet(write('Input', { row: 0, col: 4 }, TYPED)));
  const b = await saved('pq_simple.xlsx', changeSet(write('Input', { row: 0, col: 4 }, TYPED)));
  assert.deepEqual(a.out.bytes, b.out.bytes);
});

test('the check after a write refuses a range whose cells differ and a change outside the range', async () => {
  const { wb, back } = await saved('pq_simple.xlsx', changeSet(write('Input', { row: 0, col: 4 })));
  await verifyWrittenRanges(back, wb, [write('Input', { row: 0, col: 4 })]);
  await assert.rejects(() => verifyWrittenRanges(back, wb, [write('Input', { row: 0, col: 4 }, '#table({"Name", "Score"}, {{"Ann", 1}, {"Bob", 2.6}})')]), (e) => e instanceof QuoinError && e.code === 'check.part');
  await assert.rejects(() => verifyWrittenRanges(back, wb, [write('Input', { row: 0, col: 5 })]), (e) => e instanceof QuoinError && e.code === 'check.part');
});

test('a change outside the written range is caught even when the range itself is right', async () => {
  const { wb, back } = await saved('pq_simple.xlsx', changeSet(write('Input', { row: 0, col: 4 }), write('Input', { row: 0, col: 8 })));
  await assert.rejects(() => verifyWrittenRanges(back, wb, [write('Input', { row: 0, col: 4 })]), (e) => e instanceof QuoinError && e.code === 'check.part' && /outside/.test(e.message));
});
