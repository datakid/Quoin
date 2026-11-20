import test from 'node:test';
import assert from 'node:assert/strict';
import { openWorkbook } from '../../src/core/workbook.js';
import { serializeValue } from '../../src/core/m/engine.js';
import { indexWorkbook } from '../../src/batch/index/file-index.js';
import { parseRecipe } from '../../src/batch/recipe/recipe.js';
import { resolvePlan } from '../../src/batch/resolve/resolve.js';
import { runFileUnits } from '../../src/batch/execute/units.js';
import { fixture, plain } from './helpers.js';

const NOW = '2026-11-14T10:00:00.000Z';
const TABLE = (name) => `Excel.CurrentWorkbook(){[Name="${name}"]}[Content]`;
const CURRENT = TABLE('{unit.name}');
const ACCUMULATE = `let Cur = ${CURRENT}, Prev = try ${TABLE('Combined')} otherwise null in if Prev = null then Cur else Table.Combine({Prev, Cur})`;

const recipeOf = (m, output = { mode: 'newSheet', name: 'Combined' }, extra = {}) => parseRecipe(JSON.stringify({ recipe: 'transform', v: 1, scope: { type: 'tables', match: 'all' }, query: { source: 'inline', m }, ...(output ? { output } : {}), ...extra })).recipe;
const shown = (run) => plain(serializeValue(run.table, 0, { maxRows: 100 }));

async function setup(name, recipe) {
  const bytes = fixture(name);
  const index = await indexWorkbook(bytes, { id: 'f1', name, relPath: `east/${name}`, size: bytes.length });
  const plan = resolvePlan(recipe, [index], { now: NOW });
  return { wb: await openWorkbook(bytes, name), file: index, filePlan: plan.files[0] };
}

test('units run in index order, whatever order the plan lists them in', async () => {
  const { wb, file, filePlan } = await setup('pq_simple.xlsx', recipeOf(CURRENT, null));
  const seen = [];
  const reversed = { ...filePlan, units: [...filePlan.units].reverse() };
  const { runs } = await runFileUnits(wb, file, reversed, recipeOf(CURRENT, null), { now: NOW, onUnit: (run) => seen.push(run.unit.name) });
  assert.deepEqual(seen, ['StudentNames', 'StudentResults']);
  assert.deepEqual(runs.map((r) => [r.unit.index, r.status]), [[1, 'ok'], [2, 'ok']]);
});

test('a unit reads an earlier unit output by its output name', async () => {
  const recipe = recipeOf(ACCUMULATE);
  const { wb, file, filePlan } = await setup('pq_simple.xlsx', recipe);
  const { runs, cancelled } = await runFileUnits(wb, file, filePlan, recipe, { now: NOW });
  assert.equal(cancelled, false);
  assert.deepEqual(runs.map((r) => [r.status, r.outputName]), [['ok', 'Combined'], ['ok', 'Combined']]);
  assert.equal(runs[0].table.rowCount, 3);
  assert.equal(runs[1].table.rowCount, 6);
  assert.deepEqual(shown(runs[1]).columns, ['Name', 'Age', 'DateTimeGenerated']);
});

test('a unit never sees its own output and the first unit starts from nothing', async () => {
  const recipe = recipeOf(ACCUMULATE);
  const { wb, file, filePlan } = await setup('pq_simple.xlsx', recipe);
  const { runs } = await runFileUnits(wb, file, filePlan, recipe, { now: NOW });
  assert.deepEqual(shown(runs[0]).columns, ['Name', 'Age']);
  assert.equal(runs[0].table.rowCount, 3);
});

test('outputs with different names stay separate and the latest earlier output with a name wins', async () => {
  const recipe = recipeOf(`let Cur = ${CURRENT}, One = try ${TABLE('Out-1')} otherwise null in if {unit.index} = 1 then Cur else One`, { mode: 'newSheet', name: 'Out-{unit.index}' });
  const { wb, file, filePlan } = await setup('pq_simple.xlsx', recipe);
  const { runs } = await runFileUnits(wb, file, filePlan, recipe, { now: NOW });
  assert.deepEqual(runs.map((r) => r.outputName), ['Out-1', 'Out-2']);
  assert.deepEqual(shown(runs[1]), shown(runs[0]));
});

test('nothing is shared across files: a second file starts with no outputs', async () => {
  const recipe = recipeOf(ACCUMULATE);
  const first = await setup('pq_simple.xlsx', recipe);
  const second = await setup('plain_table.xlsx', recipe);
  await runFileUnits(first.wb, first.file, first.filePlan, recipe, { now: NOW });
  const { runs } = await runFileUnits(second.wb, second.file, second.filePlan, recipe, { now: NOW });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].table.rowCount, 3);
  assert.deepEqual(shown(runs[0]).columns[0], 'Dog Name');
});

test('a unit that fails registers no output, the later units still run and say what they could not read', async () => {
  const m = `let Cur = ${CURRENT}, Prev = ${TABLE('Combined')} in if {unit.index} = 1 then error "boom" else Table.Combine({Prev, Cur})`;
  const recipe = recipeOf(m);
  const { wb, file, filePlan } = await setup('pq_simple.xlsx', recipe);
  const { runs } = await runFileUnits(wb, file, filePlan, recipe, { now: NOW });
  assert.deepEqual(runs.map((r) => [r.status, r.error && r.error.code, r.outputName]), [['error', 'unit.error', null], ['error', 'unit.error', null]]);
});

test('an output name that is already a table or name in the workbook is a row error on the next unit, not a silent choice', async () => {
  const recipe = recipeOf(CURRENT, { mode: 'newSheet', name: 'StudentResults' });
  const { wb, file, filePlan } = await setup('pq_simple.xlsx', recipe);
  const { runs } = await runFileUnits(wb, file, filePlan, recipe, { now: NOW });
  assert.deepEqual([runs[0].status, runs[0].outputName], ['ok', 'StudentResults']);
  assert.deepEqual([runs[1].status, runs[1].table, runs[1].error], ['error', null, { code: 'unit.nameCollision', detail: 'StudentResults' }]);
});

test('an output keeps its values and types when a later unit reads it', async () => {
  const typed = '#table({"When", "Span", "Flag", "Num", "Txt", "Nil"}, {{#datetime(2026, 11, 14, 10, 30, 0), #duration(1, 2, 0, 0), true, 1.5, "x", null}})';
  const recipe = recipeOf(`if {unit.index} = 1 then ${typed} else ${TABLE('Typed')}`, { mode: 'newSheet', name: 'Typed' });
  const { wb, file, filePlan } = await setup('pq_simple.xlsx', recipe);
  const { runs } = await runFileUnits(wb, file, filePlan, recipe, { now: NOW });
  assert.deepEqual(runs.map((r) => r.status), ['ok', 'ok']);
  assert.deepEqual(shown(runs[1]), shown(runs[0]));
});

test('a recipe with no output name has nothing to chain and registers nothing', async () => {
  const recipe = recipeOf(`try ${TABLE('Combined')} otherwise ${CURRENT}`, { mode: 'combined' });
  const { wb, file, filePlan } = await setup('pq_simple.xlsx', recipe);
  const { runs } = await runFileUnits(wb, file, filePlan, recipe, { now: NOW });
  assert.deepEqual(runs.map((r) => r.outputName), [null, null]);
  assert.equal(runs[1].table.rowCount, 3);
});

test('a cancel check between units stops the file and reports it', async () => {
  const recipe = recipeOf(ACCUMULATE);
  const { wb, file, filePlan } = await setup('pq_simple.xlsx', recipe);
  let calls = 0;
  const { runs, cancelled } = await runFileUnits(wb, file, filePlan, recipe, { now: NOW, isCancelled: () => ++calls > 1 });
  assert.equal(cancelled, true);
  assert.deepEqual(runs.map((r) => r.unit.index), [1]);
});

test('the same file run twice gives the same tables and leaves the workbook alone', async () => {
  const recipe = recipeOf(ACCUMULATE);
  const { wb, file, filePlan } = await setup('pq_simple.xlsx', recipe);
  const a = await runFileUnits(wb, file, filePlan, recipe, { now: NOW, localOffsetMin: 0 });
  const b = await runFileUnits(wb, file, filePlan, recipe, { now: NOW, localOffsetMin: 0 });
  assert.deepEqual(a.runs.map(shown), b.runs.map(shown));
});

test('a file with no units has no runs', async () => {
  const recipe = recipeOf(CURRENT, null, { scope: { type: 'tables', match: 'pattern', pattern: 'Nothing*' } });
  const { wb, file, filePlan } = await setup('pq_simple.xlsx', recipe);
  assert.deepEqual(await runFileUnits(wb, file, filePlan, recipe, { now: NOW }), { runs: [], cancelled: false });
});

test('the progress callback sees each run with its place in the file', async () => {
  const recipe = recipeOf(ACCUMULATE);
  const { wb, file, filePlan } = await setup('pq_simple.xlsx', recipe);
  const places = [];
  await runFileUnits(wb, file, filePlan, recipe, { now: NOW, onUnit: (run, done, total) => places.push([run.unit.index, done, total]) });
  assert.deepEqual(places, [[1, 1, 2], [2, 2, 2]]);
});
