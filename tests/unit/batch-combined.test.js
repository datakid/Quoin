import test from 'node:test';
import assert from 'node:assert/strict';
import { openWorkbook } from '../../src/core/workbook.js';
import { readUsedGrid } from '../../src/core/cells.js';
import { runOnce } from '../../src/core/m/engine.js';
import { expectedGrid } from '../../src/core/sheet/grid.js';
import { tableToXlsx, tablesToXlsx, workbookFromSheets } from '../../src/core/export/xlsx.js';
import { sheetXml } from '../../src/core/sheet/sheet-xml.js';
import { STANDARD_STYLES } from '../../src/core/export/xlsx.js';
import { indexWorkbook } from '../../src/batch/index/file-index.js';
import { parseRecipe } from '../../src/batch/recipe/recipe.js';
import { resolvePlan } from '../../src/batch/resolve/resolve.js';
import { executeFile } from '../../src/batch/execute/index.js';
import { combineOutputs } from '../../src/batch/execute/combine.js';
import { fixture } from './helpers.js';

const NOW = '2026-11-14T10:00:00.000Z';
const CLOCK = new Date(NOW);
const tableOf = (m) => runOnce({ sectionText: `section Section1;\r\n\r\nshared Result =\r\n${m};`, queryName: 'Result', now: NOW, previewRows: 1 }).value;
const A = '#table({"Name", "Score"}, {{"Ann", 1}, {"Bob", 2.5}})';
const B = '#table({"D", "Flag"}, {{#date(2026, 11, 14), true}})';
const grid = async (bytes, sheet) => readUsedGrid(await openWorkbook(bytes, 'x.xlsx'), sheet);

test('many tables become one workbook with a sheet each, in order, with their own cells', async () => {
  const bytes = await tablesToXlsx([{ name: 'First', table: tableOf(A) }, { name: 'Second', table: tableOf(B) }], 'en-US', { now: CLOCK });
  const wb = await openWorkbook(bytes, 'x.xlsx');
  assert.deepEqual(wb.sheets.map((s) => s.name), ['First', 'Second']);
  assert.deepEqual(await grid(bytes, 'First'), expectedGrid(tableOf(A), 'en-US'));
  assert.deepEqual(await grid(bytes, 'Second'), expectedGrid(tableOf(B), 'en-US'));
});

test('a single bare table still gives the one sheet Result, byte for byte the same as tableToXlsx', async () => {
  const t = tableOf(A);
  assert.deepEqual(await tablesToXlsx([t], 'en-US', { now: CLOCK }), await tableToXlsx(t, 'en-US', { now: CLOCK }));
});

test('sheet names are made valid and unique with the Appendix C rules', async () => {
  const names = ['a/b', 'A/B', 'History', 'x'.repeat(40), 'x'.repeat(40)];
  const bytes = await tablesToXlsx(names.map((name) => ({ name, table: tableOf(A) })), 'en-US', { now: CLOCK });
  const wb = await openWorkbook(bytes, 'x.xlsx');
  assert.deepEqual(wb.sheets.map((s) => s.name), ['a_b', 'A_B-2', 'History-2', 'x'.repeat(31), `${'x'.repeat(29)}-2`]);
});

test('the same tables written twice give the same bytes', async () => {
  const make = () => tablesToXlsx([{ name: 'One', table: tableOf(A) }, { name: 'Two', table: tableOf(B) }], 'en-US', { now: CLOCK });
  assert.deepEqual(await make(), await make());
});

test('a workbook can be built straight from sheet parts', async () => {
  const xml = sheetXml(tableOf(A), 'en-US', STANDARD_STYLES);
  const bytes = await workbookFromSheets([{ name: 'P', xml }, { name: 'Q', xml }], { now: CLOCK });
  assert.deepEqual(await grid(bytes, 'Q'), expectedGrid(tableOf(A), 'en-US'));
});

const recipeOf = (m, output, extra = {}) => parseRecipe(JSON.stringify({ recipe: 'transform', v: 1, scope: { type: 'tables', match: 'all' }, query: { source: 'inline', m }, output, ...extra })).recipe;
const CURRENT = 'Excel.CurrentWorkbook(){[Name="{unit.name}"]}[Content]';

async function runFile(name, recipe, id) {
  const bytes = fixture(name);
  const index = await indexWorkbook(bytes, { id, name, relPath: name, size: bytes.length });
  const plan = resolvePlan(recipe, [index], { now: NOW });
  const wb = await openWorkbook(bytes, name);
  return executeFile(wb, plan.files[0], { now: NOW, recipe, meta: index, runId: 'r1' });
}

test('combined mode in a file gives sheet parts and rows, but no workbook of its own', async () => {
  const result = await runFile('pq_simple.xlsx', recipeOf(CURRENT, { mode: 'combined' }), 'f1');
  assert.deepEqual([result.outputs, result.bytes], [[], null]);
  assert.deepEqual(result.sheetParts.map((p) => [p.unit.name, p.name, p.rowIndex, p.columns, p.rows]), [['StudentNames', 'pq_simple__StudentNames', 0, 2, 3], ['StudentResults', 'pq_simple__StudentResults', 1, 3, 3]]);
  assert.deepEqual(result.rows.map((r) => [r.verdict, r.verified, r.output]), [['changed', true, ''], ['changed', true, '']]);
  assert.deepEqual(structuredClone(result.sheetParts), result.sheetParts);
});

test('combining the results of several files gives one workbook with unique sheet names and patched rows', async () => {
  const recipe = recipeOf(CURRENT, { mode: 'combined', name: '{unit.name}' });
  const one = await runFile('pq_simple.xlsx', recipe, 'f1');
  const two = await runFile('pq_simple.xlsx', recipe, 'f2');
  const combined = await combineOutputs([one, two], { now: CLOCK });
  const wb = await openWorkbook(combined.bytes, 'Combined.xlsx');
  assert.deepEqual(wb.sheets.map((s) => s.name), ['StudentNames', 'StudentResults', 'StudentNames-2', 'StudentResults-2']);
  assert.equal(combined.name, 'Combined.xlsx');
  assert.match(combined.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(combined.results.map((r) => r.rows.map((x) => [x.output, x.new_hash === combined.sha256, x.verified])), [
    [['Combined.xlsx [StudentNames]', true, true], ['Combined.xlsx [StudentResults]', true, true]],
    [['Combined.xlsx [StudentNames-2]', true, true], ['Combined.xlsx [StudentResults-2]', true, true]]
  ]);
  assert.deepEqual(await grid(combined.bytes, 'StudentResults-2'), await grid(combined.bytes, 'StudentResults'));
});

test('sheet names made of emoji stay within 31 UTF-16 units and stay unique in the combined workbook', async () => {
  const recipe = recipeOf(CURRENT, { mode: 'combined', name: '\u{1F600}'.repeat(40) });
  const results = [await runFile('pq_simple.xlsx', recipe, 'f1'), await runFile('pq_simple.xlsx', recipe, 'f2')];
  const combined = await combineOutputs(results, { now: CLOCK });
  const names = (await openWorkbook(combined.bytes, 'c.xlsx')).sheets.map((s) => s.name);
  assert.deepEqual(names, ['\u{1F600}'.repeat(15), `${'\u{1F600}'.repeat(14)}-2`, `${'\u{1F600}'.repeat(14)}-3`, `${'\u{1F600}'.repeat(14)}-4`]);
  assert.ok(names.every((n) => n.length <= 31));
});

test('a unit that failed is not in the workbook and its row stays as it was', async () => {
  const m = `let T = ${CURRENT} in if {unit.index} = 1 then error "boom" else T`;
  const result = await runFile('pq_simple.xlsx', recipeOf(m, { mode: 'combined', name: 'Out' }), 'f1');
  const combined = await combineOutputs([result], { now: CLOCK });
  assert.deepEqual((await openWorkbook(combined.bytes, 'c.xlsx')).sheets.map((s) => s.name), ['Out']);
  assert.deepEqual(combined.results[0].rows.map((r) => [r.verdict, r.reason_code, r.output]), [['failed', 'unit.error', ''], ['changed', '', 'Combined.xlsx [Out]']]);
});

test('with no usable sheet there is no workbook', async () => {
  const result = await runFile('pq_simple.xlsx', recipeOf('1 + 1', { mode: 'combined' }), 'f1');
  const combined = await combineOutputs([result], { now: CLOCK });
  assert.deepEqual([combined.bytes, combined.sha256], [null, null]);
  assert.deepEqual(combined.results[0].rows.map((r) => r.verdict), ['failed', 'failed']);
});

test('a sheet part that does not read back the way it was made stops the whole workbook', async () => {
  const result = await runFile('pq_simple.xlsx', recipeOf(CURRENT, { mode: 'combined', name: '{unit.name}' }), 'f1');
  result.sheetParts[1] = { ...result.sheetParts[1], xml: result.sheetParts[1].xml.replace('</sheetData>', '<row r="9"><c r="A9"><v>1</v></c></row></sheetData>') };
  const combined = await combineOutputs([result], { now: CLOCK });
  assert.deepEqual([combined.bytes, combined.results[0].rows.map((r) => [r.verdict, r.reason_code, r.verified])], [null, [['not-released', 'verify.readBack', false], ['not-released', 'verify.readBack', false]]]);
});

test('combined output is byte-identical when run twice in the same order', async () => {
  const recipe = recipeOf(CURRENT, { mode: 'combined', name: '{unit.name}' });
  const make = async () => combineOutputs([await runFile('pq_simple.xlsx', recipe, 'f1'), await runFile('plain_table.xlsx', recipe, 'f2')], { now: CLOCK });
  assert.equal((await make()).sha256, (await make()).sha256);
});
