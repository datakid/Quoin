import test from 'node:test';
import assert from 'node:assert/strict';
import { recipeTokens, withInjectTokens } from '../../src/batch/resolve/tokens.js';
import { parseRecipe } from '../../src/batch/recipe/recipe.js';
import { openWorkbook } from '../../src/core/workbook.js';
import { normalizeQueryText } from '../../src/core/pq/section.js';
import { indexWorkbook } from '../../src/batch/index/file-index.js';
import { sha256Text } from '../../src/batch/index/hash.js';
import { resolvePlan } from '../../src/batch/resolve/resolve.js';
import { executeFile } from '../../src/batch/execute/index.js';
import { fixture } from './helpers.js';

const transform = (m, name) => ({ recipe: 'transform', v: 1, scope: { type: 'tables', match: 'all' }, query: { source: 'inline', m }, output: { mode: 'newFile', ...(name === undefined ? {} : { name }) } });
const parsed = (json) => {
  const out = parseRecipe(JSON.stringify(json));
  assert.equal(out.ok, true);
  return out.recipe;
};

test('recipeTokens lists the known tokens a transform uses in its query text and output name, in the order of the token list', () => {
  const r = parsed(transform('Excel.CurrentWorkbook(){[Name="{unit.name}"]}[Content]', '{file.name}__{unit.index}.xlsx'));
  assert.deepEqual(recipeTokens(r), { used: ['{file.name}', '{unit.name}', '{unit.index}'], unknown: [] });
});

test('recipeTokens reports an unknown token in the output name and an unknown file or unit token in the query, never ordinary M braces', () => {
  const r = parsed(transform('let a = {1, 2}, b = "{unit.nam}" in b', '{date}-{file.name}'));
  assert.deepEqual(recipeTokens(r), { used: ['{file.name}'], unknown: ['{date}', '{unit.nam}'] });
});

test('recipeTokens finds nothing in a recipe that has no query text and no output name', () => {
  const r = parsed({ recipe: 'inject', v: 1, inject: { target: 'query', op: 'add', match: 'name', name: 'A', source: 'inline', text: 'let Source = 1 in Source', refreshOnLoad: false } });
  assert.deepEqual(recipeTokens(r), { used: [], unknown: [] });
});

test('recipeTokens does not count the same unknown token twice', () => {
  const r = parsed(transform('1', '{x}{x}'));
  assert.deepEqual(recipeTokens(r).unknown, ['{x}']);
});

test('the tokens a recipe uses include those in injected text, and unknown ones there are flagged', async () => {
  const { parseRecipe } = await import('../../src/batch/recipe/recipe.js');
  const { recipeTokens } = await import('../../src/batch/resolve/tokens.js');
  const recipe = parseRecipe(JSON.stringify({ recipe: 'inject', v: 1, inject: { source: 'inline', target: 'query', op: 'add', name: 'Where', text: 'let S = "{file.name} {unit.nam}" in S' } })).recipe;
  assert.deepEqual(recipeTokens(recipe), { used: ['{file.name}'], unknown: ['{unit.nam}'] });
});

const NOW = '2026-11-14T10:00:00.000Z';
const inject = (body) => parseRecipe(JSON.stringify({ recipe: 'inject', v: 1, inject: { source: 'inline', target: 'query', op: 'add', name: 'Where', ...body } })).recipe;

async function run(recipe, name, relPath) {
  const bytes = fixture(name);
  const index = await indexWorkbook(bytes, { id: 'f1', name: relPath.split('/').pop(), relPath, size: bytes.length });
  const plan = resolvePlan(recipe, [index], { now: NOW });
  const result = await executeFile(await openWorkbook(bytes, name), plan.files[0], { now: NOW, recipe, meta: index, runId: 'r1' });
  return { plan, result, back: result.bytes ? await openWorkbook(result.bytes, name) : null };
}

test('an injected query takes the four tokens, filled in for each file', async () => {
  const recipe = inject({ text: 'let Source = "{file.folder}|{file.name}|{unit.name}|{unit.index}" in Source' });
  const east = await run(recipe, 'pq_simple.xlsx', 'east/sales 2024.xlsx');
  const west = await run(recipe, 'pq_simple.xlsx', 'west/sales 2025.xlsx');
  const textOf = (r) => normalizeQueryText(r.back.queries.find((q) => q.name === 'Where').original);
  assert.equal(textOf(east), 'let Source = "east/|sales 2024|sales 2024|1" in Source');
  assert.equal(textOf(west), 'let Source = "west/|sales 2025|sales 2025|1" in Source');
  assert.equal(east.result.rows[0].new_hash, await sha256Text(textOf(east)));
  assert.notEqual(east.result.rows[0].new_hash, west.result.rows[0].new_hash);
});

test('a module takes the tokens too', async () => {
  const recipe = inject({ target: 'module', name: 'Helpers', text: 'Option Explicit\n\nConst WORKBOOK_NAME As String = "{file.name}"\n' });
  const { result, back } = await run(recipe, 'pq_vba_complex.xlsm', 'dir/macro book.xlsm');
  assert.equal(result.rows[0].verdict, 'changed');
  assert.match(back.vba.project.modules.find((m) => m.name === 'Helpers').model.visible, /"macro book"/);
});

test('braces that M and VBA use are left alone and only the four tokens change', () => {
  const recipe = inject({ text: 'let A = {1, 2}, B = Source{[Name="{unit.name}"]}[Content], C = {Source.Name} in B' });
  const out = withInjectTokens(recipe, { name: 'a.xlsx', relPath: 'a.xlsx' });
  assert.equal(out.inject.text, 'let A = {1, 2}, B = Source{[Name="a"]}[Content], C = {Source.Name} in B');
  assert.equal(recipe.inject.text.includes('{unit.name}'), true);
});

test('other recipes and an inject without text are returned as they are', () => {
  const align = parseRecipe(JSON.stringify({ recipe: 'align', v: 1, align: { target: 'query', name: 'Q', hash: 'a'.repeat(64) } })).recipe;
  assert.equal(withInjectTokens(align, { name: 'a.xlsx', relPath: 'a.xlsx' }), align);
  const remove = parseRecipe(JSON.stringify({ recipe: 'inject', v: 1, inject: { source: 'inline', target: 'query', op: 'remove', name: 'Q' } })).recipe;
  assert.equal(withInjectTokens(remove, { name: 'a.xlsx', relPath: 'a.xlsx' }), remove);
});

test('a token that is not one of the four in the injected text is a planning error', async () => {
  const bytes = fixture('pq_simple.xlsx');
  const index = await indexWorkbook(bytes, { id: 'f1', name: 'a.xlsx', relPath: 'a.xlsx', size: bytes.length });
  const bad = resolvePlan(inject({ text: 'let S = "{file.path} {unit.nam}" in S' }), [index], { now: NOW });
  assert.deepEqual(bad.errors, [{ code: 'recipe.token', detail: '{file.path}' }, { code: 'recipe.token', detail: '{unit.nam}' }]);
  const good = resolvePlan(inject({ text: 'let S = "{file.name}" in S' }), [index], { now: NOW });
  assert.deepEqual(good.errors, []);
});

test('the replace with-text does not take tokens', async () => {
  const recipe = parseRecipe(JSON.stringify({ recipe: 'replace', v: 1, replace: { in: ['m'], find: 'StudentNames', with: '{file.name}' } })).recipe;
  const { back } = await run(recipe, 'pq_simple.xlsx', 'x/file one.xlsx');
  assert.match(back.queries[0].original, /\{file\.name\}/);
});

test('without file metadata the tokens use the name of the workbook itself and the call does not fail', async () => {
  const bytes = fixture('pq_simple.xlsx');
  const index = await indexWorkbook(bytes, { id: 'f1', name: 'pq_simple.xlsx', relPath: 'pq_simple.xlsx', size: bytes.length });
  const recipe = inject({ text: 'let Source = "{file.name}" in Source' });
  const plan = resolvePlan(recipe, [index], { now: NOW });
  const result = await executeFile(await openWorkbook(bytes, 'pq_simple.xlsx'), plan.files[0], { now: NOW, recipe, runId: 'r1' });
  const back = await openWorkbook(result.bytes, 'pq_simple.xlsx');
  assert.equal(normalizeQueryText(back.queries.find((q) => q.name === 'Where').original), 'let Source = "pq_simple" in Source');
});
