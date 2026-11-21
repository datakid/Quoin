import test from 'node:test';
import assert from 'node:assert/strict';
import { openWorkbook } from '../../src/core/workbook.js';
import { readUsedGrid } from '../../src/core/cells.js';
import { applyChangeSet, emptyChangeSet } from '../../src/core/save.js';
import { runOnce } from '../../src/core/m/engine.js';
import { expectedGrid } from '../../src/core/sheet/grid.js';
import { addSheetsToPackage, verifyAddedSheets } from '../../src/core/sheet/add-sheets.js';
import { QuoinError } from '../../src/core/errors.js';
import { fixture } from './helpers.js';

const NOW = new Date('2026-11-14T10:00:00Z');
const open = (name) => openWorkbook(fixture(name), name);
const tableOf = (m) => runOnce({ sectionText: `section Section1;\r\n\r\nshared Result =\r\n${m};`, queryName: 'Result', now: '2026-11-14T10:00:00.000Z', previewRows: 1 }).value;
const SMALL = '#table({"Name", "Score"}, {{"Ann", 1}, {"Bob", 2.5}})';
const TYPED = '#table({"D","DT","T","Span","Flag","Num","Txt","Nil","Err"}, {{#date(2026, 11, 14), #datetime(2026, 11, 14, 10, 30, 15), #time(8, 15, 0), #duration(1, 2, 0, 0), true, 1.5, "x & <y>", null, error "no"}})';

const withSheets = (...entries) => {
  const cs = emptyChangeSet();
  cs.sheets.add.push(...entries);
  return cs;
};
const entry = (name, m = SMALL) => ({ name, table: tableOf(m), culture: 'en-US' });

const saved = async (name, cs) => {
  const wb = await open(name);
  const out = await applyChangeSet(wb, cs, { now: NOW });
  return { wb, out, back: await openWorkbook(out.bytes, name) };
};

test('a sheet is added at the end of the copy with the table as its cells', async () => {
  const { wb, back } = await saved('pq_simple.xlsx', withSheets(entry('Clean')));
  assert.deepEqual(back.sheets.map((s) => s.name), [...wb.sheets.map((s) => s.name), 'Clean']);
  assert.deepEqual(await readUsedGrid(back, 'Clean'), expectedGrid(entry('Clean').table, 'en-US'));
});

test('the queries, tables and other sheets of the source are left exactly as they were', async () => {
  const { wb, back } = await saved('pq_simple.xlsx', withSheets(entry('Clean')));
  assert.deepEqual(back.queries.map((q) => [q.name, q.original]), wb.queries.map((q) => [q.name, q.original]));
  assert.deepEqual(back.tables.map((t) => [t.name, t.ref]), wb.tables.map((t) => [t.name, t.ref]));
  for (const s of wb.sheets) assert.deepEqual(await readUsedGrid(back, s.name), await readUsedGrid(wb, s.name));
});

test('only the four parts that must change differ and exactly one part is new', async () => {
  const { wb, out } = await saved('pq_simple.xlsx', withSheets(entry('Clean')));
  const back = await openWorkbook(out.bytes, 'x.xlsx');
  const before = new Map(wb.pkg.zip.entries.map((e) => [e.name, e.crc32]));
  const changed = back.pkg.zip.entries.filter((e) => before.has(e.name) && before.get(e.name) !== e.crc32).map((e) => e.name).sort();
  const added = back.pkg.zip.entries.filter((e) => !before.has(e.name)).map((e) => e.name);
  assert.deepEqual(changed, ['[Content_Types].xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml']);
  assert.deepEqual(added, ['xl/worksheets/sheet3.xml']);
});

test('the new sheet number, sheet id and relationship id are the next free ones', async () => {
  const { back } = await saved('pq_simple.xlsx', withSheets(entry('One'), entry('Two')));
  const names = back.pkg.zip.entries.map((e) => e.name).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort();
  assert.deepEqual(names, ['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml', 'xl/worksheets/sheet4.xml']);
  const wbXml = (await back.pkg.text(back.workbookPart)).text;
  const ids = [...wbXml.matchAll(/sheetId="(\d+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  const rels = (await back.pkg.text('xl/_rels/workbook.xml.rels')).text;
  const rids = [...rels.matchAll(/Id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(rids).size, rids.length);
});

test('dates, times, durations and the other types come back typed, with date styles appended to the workbook styles', async () => {
  const { back } = await saved('pq_simple.xlsx', withSheets(entry('Typed', TYPED)));
  const grid = await readUsedGrid(back, 'Typed');
  assert.deepEqual(grid[1].map((c) => c && c.t), ['dt', 'dt', 'dt', 'dur', 'b', 'n', 's', null, 'e']);
  assert.deepEqual(grid, expectedGrid(entry('Typed', TYPED).table, 'en-US'));
});

test('a second sheet reuses the number formats the first one added', async () => {
  const { back } = await saved('pq_simple.xlsx', withSheets(entry('A', TYPED), entry('B', TYPED)));
  const styles = (await back.pkg.text('xl/styles.xml')).text;
  assert.equal((styles.match(/formatCode="yyyy\\-mm\\-dd\\ hh:mm:ss"/g) || []).length, 1);
  assert.equal((styles.match(/formatCode="\[h\]:mm:ss"/g) || []).length, 1);
  assert.deepEqual(await readUsedGrid(back, 'B'), await readUsedGrid(back, 'A'));
});

test('a macro workbook keeps its VBA project byte for byte', async () => {
  const wb = await open('pq_vba_complex.xlsm');
  const out = await applyChangeSet(wb, withSheets(entry('Clean')), { now: NOW });
  const back = await openWorkbook(out.bytes, 'm.xlsm');
  assert.deepEqual(back.vba.project.modules.map((m) => [m.name, m.text]), wb.vba.project.modules.map((m) => [m.name, m.text]));
  assert.equal(back.pkg.zip.get(wb.vba.part).crc32, wb.pkg.zip.get(wb.vba.part).crc32);
  assert.equal(back.sheets.at(-1).name, 'Clean');
});

test('the same change set written twice gives the same bytes', async () => {
  const a = await saved('pq_simple.xlsx', withSheets(entry('Clean', TYPED)));
  const b = await saved('pq_simple.xlsx', withSheets(entry('Clean', TYPED)));
  assert.deepEqual(a.out.bytes, b.out.bytes);
});

test('a workbook whose styles have no number formats gets them created in the right place', async () => {
  const wb = await open('pq_simple.xlsx');
  const pkg = wb.pkg.clone();
  const bare = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>';
  await pkg.setText('xl/styles.xml', bare);
  const { touched, addedParts } = await addSheetsToPackage(wb, pkg, [entry('Typed', TYPED)]);
  const styles = (await pkg.text('xl/styles.xml')).text;
  assert.ok(styles.indexOf('<numFmts') < styles.indexOf('<fonts'));
  assert.match(styles, /<cellXfs count="6">/);
  assert.match(styles, /<fonts count="2">/);
  assert.ok(touched.has('xl/styles.xml'));
  assert.deepEqual([...addedParts], ['xl/worksheets/sheet3.xml']);
});

test('a name that Excel would not take, or that is already used, is a programming error', async () => {
  const wb = await open('pq_simple.xlsx');
  for (const bad of ['', 'a/b', 'x'.repeat(32), 'Input', 'input', 'History']) {
    await assert.rejects(() => addSheetsToPackage(wb, wb.pkg.clone(), [entry(bad)]), TypeError, bad);
  }
  await assert.rejects(() => addSheetsToPackage(wb, wb.pkg.clone(), [entry('Same'), entry('same')]), TypeError);
});

test('adding a sheet to a copy that already got one reuses the number formats instead of repeating them', async () => {
  const first = await saved('pq_simple.xlsx', withSheets(entry('A', TYPED)));
  const wb2 = await openWorkbook(first.out.bytes, 'again.xlsx');
  const out2 = await applyChangeSet(wb2, withSheets(entry('B', TYPED)), { now: NOW });
  const back = await openWorkbook(out2.bytes, 'again.xlsx');
  const styles = (await back.pkg.text('xl/styles.xml')).text;
  assert.equal((styles.match(/formatCode="yyyy\\-mm\\-dd\\ hh:mm:ss"/g) || []).length, 1);
  assert.deepEqual(await readUsedGrid(back, 'B'), await readUsedGrid(back, 'A'));
  assert.deepEqual(back.sheets.map((s) => s.name).slice(-2), ['A', 'B']);
});

test('the check after a write refuses a sheet whose cells differ from the table, and a sheet list that is not the expected one', async () => {
  const { wb, back } = await saved('pq_simple.xlsx', withSheets(entry('Clean')));
  await verifyAddedSheets(back, wb, [entry('Clean')]);
  await assert.rejects(() => verifyAddedSheets(back, wb, [entry('Clean', '#table({"Name", "Score"}, {{"Ann", 1}, {"Bob", 2.6}})')]), (e) => e instanceof QuoinError && e.code === 'check.part');
  await assert.rejects(() => verifyAddedSheets(back, wb, [entry('Other')]), (e) => e instanceof QuoinError && e.code === 'check.part');
});

test('a workbook that binds the relationships namespace to another prefix gets its new sheet in the same form', async () => {
  const wb = await open('pq_simple.xlsx');
  const pkg = wb.pkg.clone();
  const original = await pkg.text(wb.workbookPart);
  const renamed = original.text.replace(/xmlns:r=/g, 'xmlns:rel=').replace(/ r:id=/g, ' rel:id=');
  assert.notEqual(renamed, original.text);
  await pkg.setText(wb.workbookPart, renamed, original);
  await addSheetsToPackage(wb, pkg, [entry('Clean')]);
  const text = (await pkg.text(wb.workbookPart)).text;
  assert.match(text, /<sheet name="Clean" sheetId="\d+" rel:id="rId\d+"\/>/);
});
