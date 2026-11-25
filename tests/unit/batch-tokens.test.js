import test from 'node:test';
import assert from 'node:assert/strict';
import { recipeTokens } from '../../src/batch/resolve/tokens.js';
import { parseRecipe } from '../../src/batch/recipe/recipe.js';

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
