import test from 'node:test';
import assert from 'node:assert/strict';
import { openWorkbook } from '../../src/core/workbook.js';
import { normalizeQueryText } from '../../src/core/pq/section.js';
import { indexWorkbook } from '../../src/batch/index/file-index.js';
import { sha256Text } from '../../src/batch/index/hash.js';
import { parseRecipe } from '../../src/batch/recipe/recipe.js';
import { resolvePlan } from '../../src/batch/resolve/resolve.js';
import { executeFile } from '../../src/batch/execute/index.js';
import { executeTransform } from '../../src/batch/execute/transform.js';
import { fixture } from './helpers.js';

const NOW = '2026-11-14T10:00:00.000Z';
const M = 'let T = Excel.CurrentWorkbook(){[Name="{unit.name}"]}[Content] in Table.SelectRows(T, each [Age] > 0)';

const recipeOf = (output, extra = {}) => parseRecipe(JSON.stringify({ recipe: 'transform', v: 1, compute: 'excel', scope: { type: 'tables', match: 'pattern', pattern: 'StudentNames' }, query: { source: 'inline', m: M }, output, ...extra })).recipe;

async function run(name, recipe, tweak) {
  const bytes = fixture(name);
  const index = await indexWorkbook(bytes, { id: 'f1', name, relPath: name, size: bytes.length });
  const plan = resolvePlan(recipe, [index], { now: NOW });
  const wb = await openWorkbook(bytes, name);
  if (tweak) tweak(wb);
  const result = await executeFile(wb, plan.files[0], { now: NOW, recipe, meta: index, runId: 'r1' });
  return { wb, plan, result, back: result.outputs.length ? await openWorkbook(result.outputs[0].bytes, name) : null };
}

const place = { mode: 'inPlace', name: 'StudentResults' };

test('Excel computes on open: the query text is put in the existing load target and the connection refreshes on load', async () => {
  const { wb, result, back } = await run('pq_simple.xlsx', recipeOf(place));
  assert.equal(result.outputs.length, 1);
  const want = 'let T = Excel.CurrentWorkbook(){[Name="StudentNames"]}[Content] in Table.SelectRows(T, each [Age] > 0)';
  assert.equal(normalizeQueryText(back.queries[0].original), normalizeQueryText(want));
  assert.equal(back.queries[0].connection.refreshOnLoad, true);
  assert.equal(wb.queries[0].connection.refreshOnLoad, false);
  assert.equal(back.queries[0].load.kind, 'table');
});

test('the row says Excel computes it, names the copy and the query, and carries the old and new query hashes', async () => {
  const { wb, result } = await run('pq_simple.xlsx', recipeOf(place));
  const [row] = result.rows;
  const want = 'let T = Excel.CurrentWorkbook(){[Name="StudentNames"]}[Content] in Table.SelectRows(T, each [Age] > 0)';
  assert.deepEqual([row.action, row.compute, row.verdict, row.reason_code, row.verified, row.unit], ['transform', 'excel', 'changed', '', true, 'StudentNames']);
  assert.ok(row.output.endsWith(' [query StudentResults]'));
  assert.equal(row.old_hash, await sha256Text(normalizeQueryText(wb.queries[0].original)));
  assert.equal(row.new_hash, await sha256Text(normalizeQueryText(want)));
});

test('Quoin does not evaluate the query, so one that fails at run time is still handed to Excel', async () => {
  const recipe = recipeOf(place, { query: { source: 'inline', m: 'Excel.CurrentWorkbook(){[Name="Nope"]}[Content]' } });
  const { result } = await run('pq_simple.xlsx', recipe);
  assert.deepEqual(result.rows.map((r) => r.verdict), ['changed']);
});

test('a query that does not parse is a failed row with its position, and nothing is written', async () => {
  const recipe = recipeOf(place, { query: { source: 'inline', m: 'let a = 1 + in a' } });
  const { result } = await run('pq_simple.xlsx', recipe);
  assert.deepEqual([result.rows[0].verdict, result.rows[0].reason_code, result.outputs], ['failed', 'unit.parse', []]);
  assert.match(result.rows[0].reason, /line 1, column \d+/);
});

test('a token that is not one of the four is a failed row', async () => {
  const recipe = recipeOf(place, { query: { source: 'inline', m: 'let a = "{unit.nam}" in a' } });
  const { result } = await run('pq_simple.xlsx', recipe);
  assert.deepEqual([result.rows[0].verdict, result.rows[0].reason_code], ['failed', 'recipe.token']);
});

test('a file without the named query is refused, and so is a query that has no load target', async () => {
  const none = await run('pq_simple.xlsx', recipeOf({ mode: 'inPlace', name: 'Missing' }));
  assert.deepEqual([none.result.rows[0].verdict, none.result.rows[0].reason_code, none.result.outputs], ['refused', 'refused.noQuery', []]);
  const bytes = fixture('pq_vba_complex.xlsm');
  const index = await indexWorkbook(bytes, { id: 'f1', name: 'pq_vba_complex.xlsm', relPath: 'pq_vba_complex.xlsm', size: bytes.length });
  const recipe = recipeOf({ mode: 'inPlace', name: 'fGetNamedRange' }, { scope: { type: 'workbook' } });
  const plan = resolvePlan(recipe, [index], { now: NOW });
  const result = await executeFile(await openWorkbook(bytes, 'pq_vba_complex.xlsm'), plan.files[0], { now: NOW, recipe, meta: index, runId: 'r1' });
  assert.deepEqual([result.rows[0].verdict, result.rows[0].reason_code], ['refused', 'refused.noLoadTarget']);
});

test('a sheet unit is refused because Excel can only read tables and names', async () => {
  const recipe = recipeOf(place, { scope: { type: 'sheets', match: 'pattern', pattern: 'Input' } });
  const { result } = await run('pq_simple.xlsx', recipe);
  assert.deepEqual([result.rows[0].verdict, result.rows[0].reason_code, result.outputs], ['refused', 'refused.sheetUnit', []]);
});

test('two units that want the same query: the first is written and the second is refused', async () => {
  const { result } = await run('pq_simple.xlsx', recipeOf(place, { scope: { type: 'tables', match: 'all' } }));
  assert.deepEqual(result.rows.map((r) => [r.verdict, r.reason_code]), [['changed', ''], ['refused', 'refused.overlap']]);
});

test('a macro workbook keeps its modules and every other query as they were', async () => {
  const bytes = fixture('pq_vba_complex.xlsm');
  const index = await indexWorkbook(bytes, { id: 'f1', name: 'pq_vba_complex.xlsm', relPath: 'pq_vba_complex.xlsm', size: bytes.length });
  const recipe = recipeOf({ mode: 'inPlace', name: 'FinalTable' }, { scope: { type: 'workbook' } });
  const plan = resolvePlan(recipe, [index], { now: NOW });
  const wb = await openWorkbook(bytes, 'pq_vba_complex.xlsm');
  const result = await executeFile(wb, plan.files[0], { now: NOW, recipe, meta: index, runId: 'r1' });
  assert.equal(result.rows[0].verdict, 'changed');
  const back = await openWorkbook(result.outputs[0].bytes, 'copy.xlsm');
  assert.deepEqual(back.vba.project.modules.map((m) => m.text), wb.vba.project.modules.map((m) => m.text));
  assert.equal(back.queries.find((q) => q.name === 'FinalTable').connection.refreshOnLoad, true);
  assert.deepEqual(back.queries.filter((q) => q.name !== 'FinalTable').map((q) => q.original), wb.queries.filter((q) => q.name !== 'FinalTable').map((q) => q.original));
});

test('the same file run twice gives the same copy byte for byte', async () => {
  const a = await run('pq_simple.xlsx', recipeOf(place));
  const b = await run('pq_simple.xlsx', recipeOf(place));
  assert.equal(a.result.sha256, b.result.sha256);
});

test('the plan says what Excel compute needs: a query name, and the in-place mode, with no range', async () => {
  const file = async (recipe) => {
    const bytes = fixture('pq_simple.xlsx');
    const index = await indexWorkbook(bytes, { id: 'f1', name: 'pq_simple.xlsx', relPath: 'pq_simple.xlsx', size: bytes.length });
    return resolvePlan(recipe, [index], { now: NOW }).errors;
  };
  assert.deepEqual(await file(recipeOf(place)), []);
  assert.deepEqual(await file(recipeOf({ mode: 'inPlace' })), [{ code: 'output.nameRequired', detail: null }]);
  assert.deepEqual(await file(recipeOf({ mode: 'newFile', name: 'x.xlsx' })), [{ code: 'output.excelMode', detail: 'newFile' }]);
});

test('without the change writer a recipe that would write a query says so', async () => {
  const bytes = fixture('pq_simple.xlsx');
  const index = await indexWorkbook(bytes, { id: 'f1', name: 'pq_simple.xlsx', relPath: 'pq_simple.xlsx', size: bytes.length });
  const recipe = recipeOf(place);
  const plan = resolvePlan(recipe, [index], { now: NOW });
  const wb = await openWorkbook(bytes, 'pq_simple.xlsx');
  await assert.rejects(() => executeTransform(wb, plan.files[0], recipe, { now: NOW, meta: index }), /change writer/);
});
