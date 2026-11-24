import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecipeStore, RECIPES_KEY, RECENT_KEY, MAX_RECIPES, MAX_RECENT, MAX_STORE_CHARS } from '../../src/app/recipe-store.js';
import { parseRecipe } from '../../src/batch/recipe/recipe.js';

const recipe = (name, text = 'let a = 1 in a') => parseRecipe(JSON.stringify({ recipe: 'inject', v: 1, name, inject: { target: 'query', op: 'add', name: 'Q', text, source: 'inline' } })).recipe;

function fakeStorage({ failWrites = false, failReads = false } = {}) {
  const data = new Map();
  return {
    data,
    getItem: (k) => {
      if (failReads) throw new Error('blocked');
      return data.has(k) ? data.get(k) : null;
    },
    setItem: (k, v) => {
      if (failWrites) throw new Error('quota');
      data.set(k, String(v));
    },
    removeItem: (k) => data.delete(k)
  };
}

test('the two keys are fixed', () => {
  assert.deepEqual([RECIPES_KEY, RECENT_KEY], ['quoin.recipes', 'quoin.recent']);
});

test('a new store lists nothing and writes nothing', () => {
  const st = fakeStorage();
  const store = createRecipeStore(st);
  assert.deepEqual(store.listRecipes(), { recipes: [], skipped: 0 });
  assert.deepEqual(store.recentSets(), []);
  assert.equal(st.data.size, 0);
});

test('a saved recipe is listed with its name, kind and parsed recipe', () => {
  const store = createRecipeStore(fakeStorage());
  const r = recipe('Fix sales');
  assert.deepEqual(store.saveRecipe(r), { ok: true });
  const { recipes } = store.listRecipes();
  assert.deepEqual(recipes.map((x) => [x.name, x.kind]), [['Fix sales', 'inject']]);
  assert.deepEqual(recipes[0].recipe, r);
});

test('only the two allowed keys are ever written, and recipes hold only recipe text', () => {
  const st = fakeStorage();
  const store = createRecipeStore(st);
  store.saveRecipe(recipe('A'));
  store.rememberSet('Q3 sales');
  assert.deepEqual([...st.data.keys()].sort(), ['quoin.recent', 'quoin.recipes']);
  assert.equal(JSON.parse(st.data.get('quoin.recent')).every((x) => typeof x === 'string'), true);
});

test('saving a recipe with the same name replaces it, ignoring case', () => {
  const store = createRecipeStore(fakeStorage());
  store.saveRecipe(recipe('Fix sales', 'let a = 1 in a'));
  store.saveRecipe(recipe('FIX SALES', 'let b = 2 in b'));
  const { recipes } = store.listRecipes();
  assert.equal(recipes.length, 1);
  assert.equal(recipes[0].name, 'FIX SALES');
  assert.match(recipes[0].recipe.inject.text, /let b/);
});

test('recipes are listed by name', () => {
  const store = createRecipeStore(fakeStorage());
  for (const n of ['b', 'C', 'a']) store.saveRecipe(recipe(n));
  assert.deepEqual(store.listRecipes().recipes.map((x) => x.name), ['a', 'b', 'C']);
});

test('a recipe needs a name and a valid body', () => {
  const store = createRecipeStore(fakeStorage());
  const unnamed = recipe('x');
  delete unnamed.name;
  assert.deepEqual(store.saveRecipe(unnamed), { ok: false, code: 'recipe.name' });
  assert.deepEqual(store.saveRecipe({ ...recipe('x'), name: '   ' }), { ok: false, code: 'recipe.name' });
  assert.equal(store.saveRecipe({ recipe: 'inject', v: 1, name: 'x', inject: { target: 'query', op: 'rename', name: 'Q' } }).code, 'recipe.invalid');
  assert.equal(store.saveRecipe(null).code, 'recipe.invalid');
  assert.deepEqual(store.listRecipes().recipes, []);
});

test('a recipe can be removed by name', () => {
  const store = createRecipeStore(fakeStorage());
  store.saveRecipe(recipe('A'));
  store.saveRecipe(recipe('B'));
  assert.deepEqual(store.deleteRecipe('a'), { ok: true, removed: true });
  assert.deepEqual(store.listRecipes().recipes.map((x) => x.name), ['B']);
  assert.deepEqual(store.deleteRecipe('missing'), { ok: true, removed: false });
});

test('the store holds at most fifty recipes and refuses a full store', () => {
  assert.equal(MAX_RECIPES, 50);
  const store = createRecipeStore(fakeStorage());
  for (let i = 0; i < MAX_RECIPES; i++) assert.equal(store.saveRecipe(recipe(`r${String(i).padStart(2, '0')}`)).ok, true);
  assert.deepEqual(store.saveRecipe(recipe('one too many')), { ok: false, code: 'recipe.storeFull' });
  assert.equal(store.saveRecipe(recipe('r00', 'let z = 9 in z')).ok, true);
});

test('the store refuses to grow past its character budget', () => {
  assert.equal(MAX_STORE_CHARS, 1000000);
  const store = createRecipeStore(fakeStorage());
  const big = 'x'.repeat(200 * 1024);
  for (let i = 0; i < 4; i++) assert.equal(store.saveRecipe(recipe(`b${i}`, big)).ok, true, String(i));
  assert.deepEqual(store.saveRecipe(recipe('b4', big)), { ok: false, code: 'recipe.storeFull' });
});

test('a recipe that cannot be written reports recipe.storeFull and leaves the old data', () => {
  const st = fakeStorage();
  const store = createRecipeStore(st);
  store.saveRecipe(recipe('A'));
  const before = st.data.get('quoin.recipes');
  const blocked = createRecipeStore({ ...st, setItem: () => { throw new Error('quota'); } });
  assert.deepEqual(blocked.saveRecipe(recipe('B')), { ok: false, code: 'recipe.storeFull' });
  assert.equal(st.data.get('quoin.recipes'), before);
});

test('unreadable storage lists nothing and does not throw', () => {
  const store = createRecipeStore(fakeStorage({ failReads: true }));
  assert.deepEqual(store.listRecipes(), { recipes: [], skipped: 0 });
  assert.deepEqual(store.recentSets(), []);
  assert.equal(createRecipeStore(null).saveRecipe(recipe('A')).ok, false);
  assert.deepEqual(createRecipeStore(null).recentSets(), []);
});

test('corrupt stored data is skipped without throwing, and counted', () => {
  const st = fakeStorage();
  st.data.set('quoin.recipes', '{not json');
  assert.deepEqual(createRecipeStore(st).listRecipes(), { recipes: [], skipped: 0 });
  st.data.set('quoin.recipes', JSON.stringify([{ name: 'ok', text: JSON.stringify(recipe('ok')) }, { name: 'bad', text: '{"recipe":"nope"}' }, 5, null, { name: 3 }]));
  const out = createRecipeStore(st).listRecipes();
  assert.deepEqual(out.recipes.map((x) => x.name), ['ok']);
  assert.equal(out.skipped, 4);
});

test('a stored recipe from a newer version is skipped, not lost', () => {
  const st = fakeStorage();
  st.data.set('quoin.recipes', JSON.stringify([{ name: 'future', text: '{"recipe":"collect","v":9}' }]));
  const store = createRecipeStore(st);
  assert.deepEqual(store.listRecipes(), { recipes: [], skipped: 1 });
  store.saveRecipe(recipe('mine'));
  assert.equal(JSON.parse(st.data.get('quoin.recipes')).some((x) => x.name === 'future'), true);
});

test('recent set names are kept most recent first, without duplicates, up to ten', () => {
  assert.equal(MAX_RECENT, 10);
  const store = createRecipeStore(fakeStorage());
  for (let i = 0; i < 12; i++) store.rememberSet(`Set ${i}`);
  const names = store.recentSets();
  assert.equal(names.length, 10);
  assert.deepEqual([names[0], names[9]], ['Set 11', 'Set 2']);
  store.rememberSet('set 5');
  assert.deepEqual([store.recentSets()[0], store.recentSets().filter((n) => n.toLowerCase() === 'set 5').length], ['set 5', 1]);
});

test('a recent set name is a short name with no path in it', () => {
  const store = createRecipeStore(fakeStorage());
  for (const bad of ['', '   ', 'a/b', 'a\\b', 'C:\\data', '/etc', 'x'.repeat(81), 'tab\there', 'line\nbreak', 5, null]) assert.deepEqual(store.rememberSet(bad), { ok: false, code: 'recent.name' }, String(bad));
  assert.deepEqual(store.rememberSet('  Q3 sales  '), { ok: true });
  assert.deepEqual(store.recentSets(), ['Q3 sales']);
  assert.deepEqual(store.rememberSet('x'.repeat(80)), { ok: true });
});

test('a failure to write a recent name is reported and never throws', () => {
  const store = createRecipeStore(fakeStorage({ failWrites: true }));
  assert.deepEqual(store.rememberSet('Q3'), { ok: false, code: 'recent.store' });
});

test('clear removes both keys and nothing else', () => {
  const st = fakeStorage();
  st.data.set('quoin.theme', 'dark');
  const store = createRecipeStore(st);
  store.saveRecipe(recipe('A'));
  store.rememberSet('Q3');
  store.clear();
  assert.deepEqual([...st.data.keys()], ['quoin.theme']);
});
