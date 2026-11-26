import test from 'node:test';
import assert from 'node:assert/strict';
import { saveRecipeFile, loadRecipeFile, recipeFileName, isRecipeFileName, RECIPE_FILE_MAX, RECIPE_FILE_SUFFIX } from '../../src/app/recipe-files.js';
import { parseRecipe, serialiseRecipe } from '../../src/batch/recipe/recipe.js';

const recipe = (extra = {}) => parseRecipe(JSON.stringify({ recipe: 'inject', v: 1, inject: { target: 'query', op: 'add', name: 'Clean', text: 'let a = 1 in a', source: 'inline' }, ...extra })).recipe;
const fileOf = (content, name = 'r.quoin-recipe.json') => new File([content], name);

test('the suffix and the file name come from the recipe name', () => {
  assert.equal(RECIPE_FILE_SUFFIX, '.quoin-recipe.json');
  assert.equal(recipeFileName(recipe({ name: 'Fix sales' })), 'Fix sales.quoin-recipe.json');
  assert.equal(recipeFileName(recipe()), 'inject.quoin-recipe.json');
  assert.equal(recipeFileName(recipe({ name: 'a/b:c*?' })), 'a_b_c__.quoin-recipe.json');
  assert.equal(recipeFileName(recipe({ name: '   ' })), 'inject.quoin-recipe.json');
  assert.match(recipeFileName(recipe({ name: 'x'.repeat(300) })), /^x{1,200}\.quoin-recipe\.json$/);
});

test('a recipe file is recognised by its suffix, with any case', () => {
  assert.equal(isRecipeFileName('a.quoin-recipe.json'), true);
  assert.equal(isRecipeFileName('A.QUOIN-RECIPE.JSON'), true);
  for (const n of ['a.json', 'a.xlsx', 'quoin-recipe.json', 'a.quoin-recipe.json.bak', '']) assert.equal(isRecipeFileName(n), false, n);
});

test('saving gives the canonical text, its bytes and the file name', () => {
  const r = recipe({ name: 'Fix sales' });
  const out = saveRecipeFile(r);
  assert.equal(out.ok, true);
  assert.equal(out.name, 'Fix sales.quoin-recipe.json');
  assert.equal(out.text, serialiseRecipe(r));
  assert.deepEqual(out.bytes, new TextEncoder().encode(out.text));
  assert.equal(out.bytes[0], 0x7b);
});

test('saving then loading gives back the same recipe', async () => {
  const r = recipe({ name: 'Round trip', scope: { type: 'sheets', match: 'pattern', pattern: 'D*' } });
  const saved = saveRecipeFile(r);
  const loaded = await loadRecipeFile(fileOf(saved.bytes, saved.name));
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.recipe, r);
  assert.deepEqual(loaded.warnings, []);
  assert.equal(loaded.name, saved.name);
});

test('saving refuses typed arrays, buffers, blobs, functions, symbols and bigints anywhere in the recipe', () => {
  const bad = [new Uint8Array([1, 2]), new ArrayBuffer(2), new Blob(['x']), () => 1, Symbol('s'), 10n, new DataView(new ArrayBuffer(1))];
  for (const value of bad) {
    const r = recipe();
    r.inject = { ...r.inject, text: value };
    const out = saveRecipeFile(r);
    assert.deepEqual([out.ok, out.code], [false, 'recipe.binary'], String(value));
    assert.match(out.detail, /inject\.text/);
  }
  const nested = recipe({ scope: { type: 'sheets', match: 'all', exclude: ['Notes'] } });
  nested.scope.exclude.push(new Uint8Array(1));
  assert.deepEqual([saveRecipeFile(nested).ok, saveRecipeFile(nested).code], [false, 'recipe.binary']);
});

test('saving refuses a recipe that is not valid, with the reason', () => {
  const out = saveRecipeFile({ recipe: 'inject', v: 1, inject: { target: 'query', op: 'rename', name: 'Q' } });
  assert.deepEqual([out.ok, out.code], [false, 'recipe.invalid']);
  assert.match(out.detail, /inject\.newName/);
  assert.equal(saveRecipeFile(null).code, 'recipe.invalid');
});

test('saving refuses a file over 256 KB', () => {
  assert.equal(RECIPE_FILE_MAX, 256 * 1024);
  const big = recipe();
  big.inject = { ...big.inject, text: 'x'.repeat(RECIPE_FILE_MAX) };
  const out = saveRecipeFile(big);
  assert.deepEqual([out.ok, out.code], [false, 'recipe.tooLarge']);
  const fits = recipe();
  fits.inject = { ...fits.inject, text: 'x'.repeat(100 * 1024) };
  assert.equal(saveRecipeFile(fits).ok, true);
});

test('loading refuses a file over 256 KB without reading it', async () => {
  let read = false;
  const huge = { name: 'x.quoin-recipe.json', size: RECIPE_FILE_MAX + 1, arrayBuffer: async () => ((read = true), new ArrayBuffer(0)) };
  const out = await loadRecipeFile(huge);
  assert.deepEqual([out.ok, out.code, read], [false, 'recipe.tooLarge', false]);
  assert.equal((await loadRecipeFile(fileOf(new Uint8Array(RECIPE_FILE_MAX).fill(32)))).code, 'recipe.invalid');
  assert.equal((await loadRecipeFile(fileOf(new Uint8Array(RECIPE_FILE_MAX)))).code, 'recipe.binary');
});

test('loading refuses binary content', async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x01]);
  assert.equal((await loadRecipeFile(fileOf(png, 'a.quoin-recipe.json'))).code, 'recipe.binary');
  assert.equal((await loadRecipeFile(fileOf(new Uint8Array([0x7b, 0x00, 0x7d])))).code, 'recipe.binary');
  assert.equal((await loadRecipeFile(fileOf(new Uint8Array([0x50, 0x4b, 0x03, 0x04])))).code, 'recipe.binary');
});

test('loading goes through parseRecipe: invalid, newer and unknown fields', async () => {
  assert.equal((await loadRecipeFile(fileOf('nope'))).code, 'recipe.invalid');
  assert.equal((await loadRecipeFile(fileOf('{"recipe":"collect","v":9}'))).code, 'recipe.newer');
  const withExtra = await loadRecipeFile(fileOf('{"recipe":"collect","v":1,"colour":"red"}'));
  assert.equal(withExtra.ok, true);
  assert.deepEqual(withExtra.warnings.map((w) => [w.code, w.path]), [['recipe.unknownField', 'colour']]);
});

test('a byte order mark and Windows line endings are accepted', async () => {
  const text = '\ufeff{\r\n  "recipe": "collect",\r\n  "v": 1\r\n}\r\n';
  const out = await loadRecipeFile(fileOf(text));
  assert.equal(out.ok, true);
  assert.equal(out.recipe.recipe, 'collect');
});

test('code-like text in a recipe stays text', async () => {
  const out = await loadRecipeFile(fileOf(JSON.stringify({ recipe: 'transform', v: 1, query: { source: 'inline', m: '${alert(1)} <script>' } })));
  assert.equal(out.ok, true);
  assert.equal(out.recipe.query.m, '${alert(1)} <script>');
});

test('a file that cannot be read gives recipe.unreadable rather than throwing', async () => {
  const broken = { name: 'x.quoin-recipe.json', size: 10, arrayBuffer: async () => { throw new Error('gone'); } };
  const out = await loadRecipeFile(broken);
  assert.deepEqual([out.ok, out.code], [false, 'recipe.unreadable']);
});
