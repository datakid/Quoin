import test from 'node:test';
import assert from 'node:assert/strict';
import { openWorkbook } from '../../src/core/workbook.js';
import { readUsedGrid } from '../../src/core/cells.js';
import { buildSnapshot } from '../../src/core/snapshot.js';
import { indexWorkbook } from '../../src/batch/index/file-index.js';
import { parseRecipe } from '../../src/batch/recipe/recipe.js';
import { resolvePlan } from '../../src/batch/resolve/resolve.js';
import { executeTransform } from '../../src/batch/execute/transform.js';
import { executeFile } from '../../src/batch/execute/index.js';
import { REPORT_COLUMNS } from '../../src/batch/execute/collect.js';
import { fixture } from './helpers.js';

const NOW = '2026-11-14T10:00:00.000Z';
const CURRENT = 'Excel.CurrentWorkbook(){[Name="{unit.name}"]}[Content]';

const recipeOf = (m, output, extra = {}) => parseRecipe(JSON.stringify({ recipe: 'transform', v: 1, scope: { type: 'tables', match: 'all' }, query: { source: 'inline', m }, output, ...extra })).recipe;

async function setup(name, recipe, relPath = `east/${name}`) {
  const bytes = fixture(name);
  const index = await indexWorkbook(bytes, { id: 'f1', name, relPath, size: bytes.length });
  const plan = resolvePlan(recipe, [index], { now: NOW });
  return { wb: await openWorkbook(bytes, name), index, plan, filePlan: plan.files[0] };
}

const run = async (name, recipe, extra = {}) => {
  const s = await setup(name, recipe);
  return { ...s, result: await executeTransform(s.wb, s.filePlan, recipe, { now: NOW, meta: s.index, runId: 'r1', ...extra }) };
};

const gridOf = async (bytes, sheet = 'Result') => readUsedGrid(await openWorkbook(bytes, 'out.xlsx'), sheet);

test('a new file per unit holds only that unit result as a values-only workbook with one sheet', async () => {
  const recipe = recipeOf(CURRENT, { mode: 'newFile' });
  const { wb, result } = await run('pq_simple.xlsx', recipe);
  assert.equal(result.outputs.length, 2);
  assert.deepEqual(result.outputs.map((o) => o.name), ['pq_simple__StudentNames.xlsx', 'pq_simple__StudentResults.xlsx']);
  const source = (await buildSnapshot(wb)).sources.find((s) => s.name === 'StudentNames');
  const out = await openWorkbook(result.outputs[0].bytes, 'out.xlsx');
  assert.deepEqual(out.sheets.map((s) => s.name), ['Result']);
  assert.equal(out.queries.length, 0);
  assert.deepEqual(await readUsedGrid(out, 'Result'), [source.columns.map((c) => ({ t: 's', v: c })), ...source.rows]);
});

test('each output carries a sha256 of its bytes and the unit it came from', async () => {
  const { result } = await run('pq_simple.xlsx', recipeOf(CURRENT, { mode: 'newFile' }));
  for (const o of result.outputs) {
    assert.match(o.sha256, /^[0-9a-f]{64}$/);
    assert.ok(o.bytes.length > 100);
  }
  assert.deepEqual(result.outputs.map((o) => [o.unit.kind, o.unit.name, o.unit.index]), [['table', 'StudentNames', 1], ['table', 'StudentResults', 2]]);
});

test('the name template of the recipe is used with its tokens filled in per unit', async () => {
  const recipe = recipeOf(CURRENT, { mode: 'newFile', name: '{file.folder}{file.name}__{unit.name}-{unit.index}.xlsx' });
  const { result } = await run('pq_simple.xlsx', recipe);
  assert.deepEqual(result.outputs.map((o) => o.name), ['east/pq_simple__StudentNames-1.xlsx', 'east/pq_simple__StudentResults-2.xlsx']);
});

test('the report has one row per unit with the output name and verified set after the file was read back', async () => {
  const { result } = await run('pq_simple.xlsx', recipeOf(CURRENT, { mode: 'newFile' }));
  assert.equal(result.rows.length, 2);
  for (const row of result.rows) assert.deepEqual(Object.keys(row), REPORT_COLUMNS);
  assert.deepEqual(result.rows.map((r) => [r.run_id, r.file, r.folder, r.unit, r.unit_index, r.recipe, r.action, r.compute, r.verdict, r.reason_code, r.output, r.verified]), [
    ['r1', 'pq_simple.xlsx', 'east/', 'StudentNames', 1, 'transform', 'transform', 'quoin', 'changed', '', 'pq_simple__StudentNames.xlsx', true],
    ['r1', 'pq_simple.xlsx', 'east/', 'StudentResults', 2, 'transform', 'transform', 'quoin', 'changed', '', 'pq_simple__StudentResults.xlsx', true]
  ]);
  assert.equal(result.rows[0].new_hash, result.outputs[0].sha256);
});

test('a unit that fails is a failed row with its reason and the substituted query, and the other units still produce files', async () => {
  const m = 'if {unit.index} = 1 then 1 + else Excel.CurrentWorkbook(){[Name="{unit.name}"]}[Content]';
  const { result } = await run('pq_simple.xlsx', recipeOf(m, { mode: 'newFile' }));
  assert.deepEqual(result.outputs, []);
  assert.deepEqual(result.rows.map((r) => [r.verdict, r.reason_code, r.output, r.verified]), [['failed', 'unit.parse', '', false], ['failed', 'unit.parse', '', false]]);
  assert.equal(result.failures[0].m.startsWith('if 1 = 1 then 1 + else'), true);
  assert.equal(result.failures[0].error.code, 'unit.parse');
});

test('one unit failing leaves the others written', async () => {
  const m = `let T = ${CURRENT} in if {unit.index} = 1 then error "boom" else T`;
  const { result } = await run('pq_simple.xlsx', recipeOf(m, { mode: 'newFile' }));
  assert.deepEqual(result.outputs.map((o) => o.name), ['pq_simple__StudentResults.xlsx']);
  assert.deepEqual(result.rows.map((r) => [r.verdict, r.reason_code, r.output]), [['failed', 'unit.error', ''], ['changed', '', 'pq_simple__StudentResults.xlsx']]);
});

test('typed values survive the file: dates, times, durations, logicals, numbers, text, nulls and errors', async () => {
  const typed = '#table({"D","DT","T","Span","Flag","Num","Txt","Nil","Err"}, {{#date(2026, 11, 14), #datetime(2026, 11, 14, 10, 30, 0), #time(8, 15, 0), #duration(1, 2, 0, 0), true, 1.5, "x", null, error "no"}})';
  const { result } = await run('pq_simple.xlsx', recipeOf(typed, { mode: 'newFile' }), {});
  assert.equal(result.rows[0].verdict, 'changed');
  assert.equal(result.rows[0].verified, true);
  const grid = await gridOf(result.outputs[0].bytes);
  assert.deepEqual(grid[1].map((c) => c && c.t), ['dt', 'dt', 'dt', 'dur', 'b', 'n', 's', null, 'e']);
});

test('text with line breaks and surrounding spaces is read back the way it was written', async () => {
  const m = '#table({"A"}, {{" lead and trail "}, {"line one#(lf)line two"}, {"cr#(cr)#(lf)lf"}, {"tab#(tab)here"}})';
  const { result } = await run('pq_simple.xlsx', recipeOf(m, { mode: 'newFile' }));
  assert.equal(result.rows[0].verified, true);
  const grid = await gridOf(result.outputs[0].bytes);
  assert.deepEqual(grid.slice(1).map((r) => r[0].v), [' lead and trail ', 'line one\nline two', 'cr\r\nlf', 'tab\there']);
});

test('a table with more columns than a sheet holds is refused, not cut', async () => {
  const m = 'Table.FromRows({List.Numbers(1, 16385)}, List.Transform(List.Numbers(1, 16385), each "c" & Text.From(_)))';
  const { result } = await run('pq_simple.xlsx', recipeOf(m, { mode: 'newFile' }));
  assert.deepEqual(result.outputs, []);
  assert.deepEqual(result.rows.map((r) => [r.verdict, r.reason_code, r.verified]), [['refused', 'refused.tooLarge', false], ['refused', 'refused.tooLarge', false]]);
});

test('a cell with more than 32767 characters is refused, not cut', async () => {
  const m = '#table({"A"}, {{Text.Repeat("x", 40000)}})';
  const { result } = await run('pq_simple.xlsx', recipeOf(m, { mode: 'newFile' }));
  assert.deepEqual(result.outputs, []);
  assert.deepEqual(result.rows.map((r) => [r.verdict, r.reason_code]), [['refused', 'refused.cellTooLong'], ['refused', 'refused.cellTooLong']]);
});

test('the same file run twice gives byte-identical outputs', async () => {
  const recipe = recipeOf(CURRENT, { mode: 'newFile' });
  const a = await run('pq_simple.xlsx', recipe);
  const b = await run('pq_simple.xlsx', recipe);
  assert.deepEqual(a.result.outputs.map((o) => o.sha256), b.result.outputs.map((o) => o.sha256));
  assert.deepEqual(a.result.rows.map((r) => r.new_hash), b.result.rows.map((r) => r.new_hash));
});

test('a sheet scope gives one output per sheet unit with raw cells', async () => {
  const recipe = recipeOf(CURRENT, { mode: 'newFile', name: '{unit.name}.xlsx' }, { scope: { type: 'sheets', match: 'pattern', pattern: 'Input' } });
  const { result } = await run('pq_simple.xlsx', recipe);
  assert.deepEqual(result.outputs.map((o) => o.name), ['Input.xlsx']);
  const grid = await gridOf(result.outputs[0].bytes);
  assert.deepEqual([grid[0][0].v, grid[1][0].v], ['Column1', 'Name']);
});

test('the compute mode Excel and the other output modes are not written by this function yet', async () => {
  const s = await setup('pq_simple.xlsx', recipeOf(CURRENT, { mode: 'newFile' }, { compute: 'excel' }));
  await assert.rejects(() => executeTransform(s.wb, s.filePlan, recipeOf(CURRENT, { mode: 'newFile' }, { compute: 'excel' }), { now: NOW, meta: s.index }), /excel/);
});

test('executeFile hands a transform recipe to the transform step and returns its outputs', async () => {
  const recipe = recipeOf(CURRENT, { mode: 'newFile' });
  const s = await setup('pq_simple.xlsx', recipe);
  const viaEntry = await executeFile(s.wb, s.filePlan, { now: NOW, recipe, meta: s.index, runId: 'r1' });
  const direct = await executeTransform(s.wb, s.filePlan, recipe, { now: NOW, meta: s.index, runId: 'r1' });
  assert.deepEqual(viaEntry.outputs.map((o) => [o.name, o.sha256]), direct.outputs.map((o) => [o.name, o.sha256]));
  assert.deepEqual(viaEntry.rows.map((r) => r.verdict), ['changed', 'changed']);
});
