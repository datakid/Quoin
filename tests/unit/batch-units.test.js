import test from 'node:test';
import assert from 'node:assert/strict';
import { openWorkbook } from '../../src/core/workbook.js';
import { buildSnapshot, buildUnitSnapshot } from '../../src/core/snapshot.js';
import { readUsedGrid } from '../../src/core/cells.js';
import { serializeValue } from '../../src/core/m/engine.js';
import { parseRecipe } from '../../src/batch/recipe/recipe.js';
import { prepareQuery, runUnit } from '../../src/batch/execute/units.js';
import { fixture, plain } from './helpers.js';

const NOW = '2026-11-14T10:00:00.000Z';
const FILE = { name: '2024-sales.xlsx', relPath: 'east/2024-sales.xlsx' };

const recipeWith = (m, more) => parseRecipe(JSON.stringify({ recipe: 'transform', v: 1, scope: { type: 'sheets', match: 'all' }, query: { source: 'inline', m }, ...(more ? { more } : {}) })).recipe;
const sheetUnit = (name, index = 1) => ({ fileId: 'f1', kind: 'sheet', name, index });
const tableUnit = (name, index = 1) => ({ fileId: 'f1', kind: 'table', name, index });
const workbookUnit = (name = 'plain_table', index = 1) => ({ fileId: 'f1', kind: 'workbook', name, index });
const open = (name) => openWorkbook(fixture(name), name);
const shown = (run) => plain(serializeValue(run.table, 0, { maxRows: 100 }));
const CONTENT = 'Excel.CurrentWorkbook(){[Name="{unit.name}"]}[Content]';

test('a sheet unit joins the snapshot as its used range with Column1 to ColumnN and no header row promoted', async () => {
  const wb = await open('plain_table.xlsx');
  const grid = await readUsedGrid(wb, 'Toy Group Scores');
  const { snapshot, error } = await buildUnitSnapshot(wb, sheetUnit('Toy Group Scores'));
  assert.equal(error, null);
  const source = snapshot.sources.find((s) => s.name === 'Toy Group Scores');
  assert.equal(source.kind, 'sheet');
  assert.equal(source.queryLoaded, false);
  assert.deepEqual(source.columns, ['Column1', 'Column2', 'Column3', 'Column4', 'Column5', 'Column6', 'Column7', 'Column8']);
  assert.deepEqual(source.rows, grid);
  assert.equal(source.rows.length, 4);
  assert.deepEqual(source.rows[0][0], { t: 's', v: 'Dog Name' });
});

test('the unit snapshot leaves the sources a plain snapshot has exactly as they are', async () => {
  const wb = await open('plain_table.xlsx');
  const plainSnapshot = await buildSnapshot(wb);
  const { snapshot } = await buildUnitSnapshot(wb, sheetUnit('Toy Group Scores'));
  assert.deepEqual(snapshot.sources.slice(0, plainSnapshot.sources.length), plainSnapshot.sources);
  assert.equal(snapshot.sources.length, plainSnapshot.sources.length + 1);
  assert.equal(snapshot.date1904, plainSnapshot.date1904);
});

test('a table unit is the table with its own header names and a workbook unit adds nothing', async () => {
  const wb = await open('plain_table.xlsx');
  const plainSnapshot = await buildSnapshot(wb);
  const table = await buildUnitSnapshot(wb, tableUnit('DogShowResults'));
  assert.deepEqual(table.snapshot, plainSnapshot);
  assert.equal(table.snapshot.sources.find((s) => s.name === 'DogShowResults').columns[0], 'Dog Name');
  const book = await buildUnitSnapshot(wb, workbookUnit());
  assert.deepEqual(book.snapshot, plainSnapshot);
});

test('a prepared snapshot is reused and never changed by the units that use it', async () => {
  const wb = await open('plain_table.xlsx');
  const base = await buildSnapshot(wb);
  const frozen = JSON.stringify(base);
  const first = await buildUnitSnapshot(wb, sheetUnit('Toy Group Scores'), { base });
  assert.equal(first.snapshot.sources.length, 2);
  assert.equal(JSON.stringify(base), frozen);
  assert.equal(base.sources.length, 1);
});

test('a sheet that shares its name with a table or a name is an error naming it, never a silent choice', async () => {
  const wb = await open('pq_simple.xlsx');
  const clash = await buildUnitSnapshot(wb, sheetUnit('StudentResults'));
  assert.deepEqual([clash.snapshot, clash.error], [null, { code: 'unit.nameCollision', detail: 'StudentResults' }]);
  const fine = await buildUnitSnapshot(wb, sheetUnit('Input'));
  assert.equal(fine.error, null);
  const asTable = await buildUnitSnapshot(wb, tableUnit('StudentResults'));
  assert.equal(asTable.error, null);
});

test('a unit the workbook does not have is an error naming it', async () => {
  const wb = await open('plain_table.xlsx');
  assert.deepEqual((await buildUnitSnapshot(wb, sheetUnit('Nope'))).error, { code: 'unit.missing', detail: 'Nope' });
  assert.deepEqual((await buildUnitSnapshot(wb, tableUnit('Nope'))).error, { code: 'unit.missing', detail: 'Nope' });
});

test('a query reads a sheet unit as raw cells with the header row as data', async () => {
  const wb = await open('plain_table.xlsx');
  const run = await runUnit(wb, FILE, sheetUnit('Toy Group Scores'), recipeWith(CONTENT), { now: NOW });
  assert.equal(run.status, 'ok');
  assert.equal(run.error, null);
  const t = shown(run);
  assert.deepEqual(t.columns, ['Column1', 'Column2', 'Column3', 'Column4', 'Column5', 'Column6', 'Column7', 'Column8']);
  assert.equal(t.rows.length, 4);
  assert.equal(t.rows[0][0], 'Dog Name');
  assert.equal(t.rows[1][1], 10);
});

test('a query reads a table unit with its headers', async () => {
  const wb = await open('plain_table.xlsx');
  const run = await runUnit(wb, FILE, tableUnit('DogShowResults'), recipeWith(CONTENT), { now: NOW });
  assert.equal(run.status, 'ok');
  const t = shown(run);
  assert.equal(t.columns[0], 'Dog Name');
  assert.equal(t.columns.length, 8);
  assert.equal(t.rows.length, 3);
});

test('tokens are replaced as raw text before the query is parsed', async () => {
  const wb = await open('plain_table.xlsx');
  const m = 'let Text = "{file.folder}|{file.name}|{unit.name}|{unit.index}" in #table({"Value"}, {{Text}})';
  const run = await runUnit(wb, FILE, sheetUnit('Toy Group Scores', 2), recipeWith(m), { now: NOW });
  assert.equal(run.status, 'ok');
  assert.equal(run.m, 'let Text = "east/|2024-sales|Toy Group Scores|2" in #table({"Value"}, {{Text}})');
  assert.deepEqual(shown(run), { columns: ['Value'], rows: [['east/|2024-sales|Toy Group Scores|2']] });
});

test('tokens that are not one of the four are a row error and the query is not run', async () => {
  const wb = await open('plain_table.xlsx');
  const run = await runUnit(wb, FILE, sheetUnit('Toy Group Scores'), recipeWith('let S = "{unit.nam} {file.path}" in #table({"V"}, {{S}})'), { now: NOW });
  assert.deepEqual([run.status, run.table, run.error], ['error', null, { code: 'recipe.token', detail: '{unit.nam}, {file.path}' }]);
});

test('braces that M uses itself are left alone', () => {
  const m = 'let A = {1, 2}, B = Source{[Name="{unit.name}"]}[Content], C = {Source.Name} in B';
  const prepared = prepareQuery(m, FILE, sheetUnit('Data', 3));
  assert.deepEqual(prepared, { ok: true, text: 'let A = {1, 2}, B = Source{[Name="Data"]}[Content], C = {Source.Name} in B', error: null });
});

test('a parse failure is a row error that carries the substituted query and a position inside it', async () => {
  const wb = await open('plain_table.xlsx');
  const run = await runUnit(wb, FILE, sheetUnit('Toy Group Scores'), recipeWith('let a = "{unit.name}" + in a'), { now: NOW });
  assert.equal(run.status, 'error');
  assert.equal(run.table, null);
  assert.equal(run.m, 'let a = "Toy Group Scores" + in a');
  assert.deepEqual([run.error.code, run.error.line, run.error.col], ['unit.parse', 1, 30]);
  assert.equal(typeof run.error.message, 'string');
});

test('an error from M is a row error with its reason', async () => {
  const wb = await open('plain_table.xlsx');
  const run = await runUnit(wb, FILE, sheetUnit('Toy Group Scores'), recipeWith('Excel.CurrentWorkbook(){[Name="Nope"]}[Content]'), { now: NOW });
  assert.equal(run.status, 'error');
  assert.equal(run.error.code, 'unit.error');
  assert.equal(typeof run.error.reason, 'string');
  assert.equal(typeof run.error.message, 'string');
});

test('a result that is not a table is a row error', async () => {
  const wb = await open('plain_table.xlsx');
  const run = await runUnit(wb, FILE, sheetUnit('Toy Group Scores'), recipeWith('1 + 1'), { now: NOW });
  assert.deepEqual([run.status, run.table, run.error], ['error', null, { code: 'unit.notTable', detail: 'number' }]);
});

test('a query that asks for a file is a row error because a batch has no files to give it', async () => {
  const wb = await open('plain_table.xlsx');
  const run = await runUnit(wb, FILE, sheetUnit('Toy Group Scores'), recipeWith('Csv.Document(File.Contents("c:\\\\x.csv"))'), { now: NOW });
  assert.deepEqual([run.status, run.error.code, run.error.detail], ['error', 'unit.binding', 'c:\\\\x.csv']);
});

test('the run limits of the recipe stop a unit and say which limit', async () => {
  const wb = await open('plain_table.xlsx');
  const run = await runUnit(wb, FILE, sheetUnit('Toy Group Scores'), recipeWith('Table.FromList(List.Numbers(1, 50))', { limits: { maxRows: 5 } }), { now: NOW });
  assert.deepEqual([run.status, run.table, run.error.code], ['stopped', null, 'm.rows']);
});

test('a unit with a name clash is a row error and the query is not run', async () => {
  const wb = await open('pq_simple.xlsx');
  const run = await runUnit(wb, FILE, sheetUnit('StudentResults'), recipeWith(CONTENT), { now: NOW });
  assert.deepEqual([run.status, run.table, run.error], ['error', null, { code: 'unit.nameCollision', detail: 'StudentResults' }]);
  assert.equal(run.m, 'Excel.CurrentWorkbook(){[Name="StudentResults"]}[Content]');
});

test('the same unit run twice gives the same table and the time must be frozen', async () => {
  const wb = await open('plain_table.xlsx');
  const recipe = recipeWith('let Now = DateTime.LocalNow() in #table({"When"}, {{Now}})');
  const a = await runUnit(wb, FILE, sheetUnit('Toy Group Scores'), recipe, { now: NOW, localOffsetMin: 0 });
  const b = await runUnit(wb, FILE, sheetUnit('Toy Group Scores'), recipe, { now: NOW, localOffsetMin: 0 });
  assert.deepEqual(shown(a), shown(b));
  assert.deepEqual(shown(a).rows, [['datetime:2026-11-14T10:00:00']]);
  await assert.rejects(() => runUnit(wb, FILE, sheetUnit('Toy Group Scores'), recipe, { now: 'today' }), /now/);
});

test('a unit run keeps one result per unit and reports how long it took', async () => {
  const wb = await open('plain_table.xlsx');
  const run = await runUnit(wb, FILE, tableUnit('DogShowResults'), recipeWith(CONTENT), { now: NOW });
  assert.deepEqual(Object.keys(run).sort(), ['durationMs', 'error', 'flags', 'm', 'status', 'table', 'unit']);
  assert.equal(typeof run.durationMs, 'number');
  assert.deepEqual(run.unit, tableUnit('DogShowResults'));
  assert.deepEqual(run.flags, []);
});
