import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRecipe, serialiseRecipe, TOKENS, unknownTokens, RECIPE_VERSION, RECIPE_KINDS } from '../../src/batch/recipe/recipe.js';

const json = (o) => JSON.stringify(o);
const ok = (o) => {
  const r = parseRecipe(typeof o === 'string' ? o : json(o));
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
};
const bad = (o) => {
  const r = parseRecipe(typeof o === 'string' ? o : json(o));
  assert.equal(r.ok, false);
  return r;
};

test('the supported version and the five recipe kinds are fixed', () => {
  assert.equal(RECIPE_VERSION, 1);
  assert.deepEqual(RECIPE_KINDS, ['collect', 'inject', 'replace', 'transform', 'align']);
});

test('a minimal collect recipe parses and gets the documented defaults', () => {
  const { recipe, warnings } = ok({ recipe: 'collect', v: 1 });
  assert.deepEqual(warnings, []);
  assert.equal(recipe.recipe, 'collect');
  assert.equal(recipe.v, 1);
  assert.deepEqual(recipe.scope, { type: 'workbook', match: 'all', excludeHidden: true });
  assert.equal(recipe.compute, 'quoin');
  assert.deepEqual(recipe.more, { culture: 'en-US', limits: { timeoutMs: 30000, maxRows: 1000000 }, encoding: 'utf-8', csvGuard: true });
});

test('text that is not JSON or not an object is invalid', () => {
  for (const t of ['', 'nope', '[1]', '"x"', '5', 'null']) {
    const r = bad(t);
    assert.equal(r.code, 'recipe.invalid', t);
  }
});

test('nothing in a recipe is evaluated, so code-like text stays text', () => {
  const r = ok({ recipe: 'inject', v: 1, inject: { target: 'query', op: 'add', name: 'Q', text: 'let x = 1 in x', source: 'inline' }, name: '${process.exit(1)} __proto__' });
  assert.equal(r.recipe.name, '${process.exit(1)} __proto__');
  assert.equal(r.recipe.inject.text, 'let x = 1 in x');
});

test('a missing or unknown recipe kind and a missing or bad version are invalid', () => {
  assert.equal(bad({ v: 1 }).code, 'recipe.invalid');
  assert.equal(bad({ recipe: 'merge', v: 1 }).code, 'recipe.invalid');
  assert.equal(bad({ recipe: 'collect' }).code, 'recipe.invalid');
  for (const v of [0, -1, 1.5, '1', null]) assert.equal(bad({ recipe: 'collect', v }).code, 'recipe.invalid', String(v));
});

test('a newer version is refused with recipe.newer before anything else is checked', () => {
  const r = bad({ recipe: 'collect', v: 2, scope: 'not even an object' });
  assert.equal(r.code, 'recipe.newer');
  assert.equal(parseRecipe(json({ recipe: 'whatever', v: 99 })).code, 'recipe.newer');
});

test('unknown fields give a warning with their path and are dropped', () => {
  const { recipe, warnings } = ok({ recipe: 'collect', v: 1, colour: 'red', scope: { type: 'sheets', match: 'all', depth: 3 }, more: { speed: 'fast' } });
  assert.deepEqual(warnings.map((w) => [w.code, w.path]).sort(), [['recipe.unknownField', 'colour'], ['recipe.unknownField', 'more.speed'], ['recipe.unknownField', 'scope.depth']]);
  assert.equal('colour' in recipe, false);
  assert.equal('depth' in recipe.scope, false);
});

test('a block that belongs to another recipe kind is ignored with a warning', () => {
  const { recipe, warnings } = ok({ recipe: 'collect', v: 1, replace: { in: ['m'], find: 'a', with: 'b', kind: 'text', matchCase: true }, align: { target: 'query', name: 'Q', hash: 'a'.repeat(64) } });
  assert.deepEqual(warnings.map((w) => [w.code, w.path]), [['recipe.ignored', 'replace'], ['recipe.ignored', 'align']]);
  assert.equal('replace' in recipe, false);
  assert.equal('align' in recipe, false);
});

test('the block for the chosen kind is required', () => {
  for (const kind of ['inject', 'replace', 'transform', 'align']) {
    const r = bad({ recipe: kind, v: 1 });
    assert.equal(r.code, 'recipe.invalid', kind);
    assert.match(r.detail, new RegExp(kind));
  }
});

test('scope: type, match and pattern rules', () => {
  assert.equal(ok({ recipe: 'collect', v: 1, scope: { type: 'tables', match: 'pattern', pattern: 'Data*' } }).recipe.scope.patternKind, 'glob');
  assert.equal(bad({ recipe: 'collect', v: 1, scope: { type: 'cells', match: 'all' } }).code, 'recipe.invalid');
  assert.equal(bad({ recipe: 'collect', v: 1, scope: { type: 'sheets', match: 'some' } }).code, 'recipe.invalid');
  assert.equal(bad({ recipe: 'collect', v: 1, scope: { type: 'sheets', match: 'pattern' } }).code, 'recipe.invalid');
  assert.equal(bad({ recipe: 'collect', v: 1, scope: { type: 'sheets', match: 'pattern', pattern: '(', patternKind: 'regex' } }).code, 'recipe.invalid');
  assert.equal(ok({ recipe: 'collect', v: 1, scope: { type: 'sheets', match: 'pattern', pattern: '^Data\\d+$', patternKind: 'regex' } }).recipe.scope.patternKind, 'regex');
  assert.equal(bad({ recipe: 'collect', v: 1, scope: { type: 'sheets', match: 'pattern', pattern: 'x', patternKind: 'sql' } }).code, 'recipe.invalid');
});

test('scope: position rules', () => {
  const pos = (position) => ({ recipe: 'collect', v: 1, scope: { type: 'sheets', match: 'position', position } });
  for (const p of [{ kind: 'first' }, { kind: 'last' }, { kind: 'index', index: 2 }, { kind: 'range', from: 1, to: 3 }]) ok(pos(p));
  for (const p of [undefined, { kind: 'middle' }, { kind: 'index' }, { kind: 'index', index: 0 }, { kind: 'index', index: 1.5 }, { kind: 'range', from: 3, to: 1 }, { kind: 'range', from: 1 }]) assert.equal(bad(pos(p)).code, 'recipe.invalid', JSON.stringify(p));
});

test('scope: flags and the exclude list have to be the right type', () => {
  assert.equal(bad({ recipe: 'collect', v: 1, scope: { type: 'sheets', match: 'all', onlyNonEmpty: 'yes' } }).code, 'recipe.invalid');
  assert.equal(bad({ recipe: 'collect', v: 1, scope: { type: 'sheets', match: 'all', exclude: 'Notes' } }).code, 'recipe.invalid');
  assert.equal(bad({ recipe: 'collect', v: 1, scope: { type: 'sheets', match: 'all', exclude: ['Notes', 3] } }).code, 'recipe.invalid');
  const s = ok({ recipe: 'collect', v: 1, scope: { type: 'sheets', match: 'all', onlyNonEmpty: true, onlyWithHeader: true, excludeHidden: false, exclude: ['Notes'] } }).recipe.scope;
  assert.deepEqual([s.onlyNonEmpty, s.onlyWithHeader, s.excludeHidden, s.exclude], [true, true, false, ['Notes']]);
});

test('overrides list a file, its path and the units that were pinned', () => {
  const r = ok({ recipe: 'collect', v: 1, overrides: [{ file: '2024-sales.xlsx', path: 'east/2024-sales.xlsx', units: ['Data'] }] });
  assert.deepEqual(r.recipe.overrides, [{ file: '2024-sales.xlsx', path: 'east/2024-sales.xlsx', units: ['Data'] }]);
  assert.equal(bad({ recipe: 'collect', v: 1, overrides: {} }).code, 'recipe.invalid');
  assert.equal(bad({ recipe: 'collect', v: 1, overrides: [{ file: 'a.xlsx', units: ['x'] }] }).code, 'recipe.invalid');
  assert.equal(bad({ recipe: 'collect', v: 1, overrides: [{ file: 'a.xlsx', path: 'a.xlsx', units: 'x' }] }).code, 'recipe.invalid');
});

test('inject: the operation decides which fields are needed', () => {
  const inj = (o) => ({ recipe: 'inject', v: 1, inject: { target: 'query', source: 'inline', ...o } });
  const add = ok(inj({ op: 'add', name: 'CleanSales', text: 'let a = 1 in a', refreshOnLoad: true })).recipe.inject;
  assert.deepEqual([add.target, add.op, add.match, add.name, add.newName, add.refreshOnLoad], ['query', 'add', 'name', 'CleanSales', null, true]);
  ok(inj({ op: 'replace', name: 'Q', text: 'let a = 1 in a' }));
  ok(inj({ op: 'rename', name: 'Q', newName: 'Q2' }));
  ok(inj({ op: 'remove', name: 'Q' }));
  assert.equal(bad(inj({ op: 'add', name: 'Q' })).code, 'recipe.invalid');
  assert.equal(bad(inj({ op: 'replace', name: 'Q' })).code, 'recipe.invalid');
  assert.equal(bad(inj({ op: 'rename', name: 'Q' })).code, 'recipe.invalid');
  assert.equal(bad(inj({ op: 'rename', name: 'Q', newName: '' })).code, 'recipe.invalid');
  assert.equal(bad(inj({ op: 'remove' })).code, 'recipe.invalid');
  assert.equal(bad(inj({ op: 'clone', name: 'Q' })).code, 'recipe.invalid');
  assert.equal(bad(inj({ op: 'remove', name: 'Q', target: 'sheet' })).code, 'recipe.invalid');
  assert.equal(bad(inj({ op: 'add', name: 'Q', text: 'x', source: 'file' })).code, 'recipe.invalid');
});

test('inject: a module target and a pattern match are accepted', () => {
  ok({ recipe: 'inject', v: 1, inject: { target: 'module', op: 'remove', match: 'pattern', name: 'Old*' } });
  assert.equal(bad({ recipe: 'inject', v: 1, inject: { target: 'query', op: 'remove', match: 'fuzzy', name: 'Q' } }).code, 'recipe.invalid');
});

test('replace: where, what and how', () => {
  const rep = (o) => ({ recipe: 'replace', v: 1, replace: { in: ['m', 'vba'], find: 'srv-old', with: 'srv-new', kind: 'text', matchCase: true, ...o } });
  ok(rep({}));
  ok(rep({ in: ['m'] }));
  ok(rep({ with: '' }));
  assert.equal(bad(rep({ in: [] })).code, 'recipe.invalid');
  assert.equal(bad(rep({ in: ['sheet'] })).code, 'recipe.invalid');
  assert.equal(bad(rep({ find: '' })).code, 'recipe.invalid');
  assert.equal(bad(rep({ with: 3 })).code, 'recipe.invalid');
  assert.equal(bad(rep({ kind: 'regex', find: '(' })).code, 'recipe.invalid');
  assert.equal(ok(rep({ kind: 'regex', find: 'srv-\\d+' })).recipe.replace.kind, 'regex');
  assert.equal(bad(rep({ matchCase: 'yes' })).code, 'recipe.invalid');
});

test('transform needs inline query text and align needs a name and a full hash', () => {
  ok({ recipe: 'transform', v: 1, query: { source: 'inline', m: 'let a = 1 in a' } });
  assert.equal(bad({ recipe: 'transform', v: 1, query: { source: 'inline', m: '' } }).code, 'recipe.invalid');
  assert.equal(bad({ recipe: 'transform', v: 1, query: { source: 'file', m: 'x' } }).code, 'recipe.invalid');
  ok({ recipe: 'align', v: 1, align: { target: 'query', name: 'Q', hash: 'ab'.repeat(32) } });
  assert.equal(bad({ recipe: 'align', v: 1, align: { target: 'query', name: 'Q', hash: 'abc' } }).code, 'recipe.invalid');
  assert.equal(bad({ recipe: 'align', v: 1, align: { target: 'query', name: 'Q', hash: 'AB'.repeat(32) } }).code, 'recipe.invalid');
  assert.equal(bad({ recipe: 'align', v: 1, align: { target: 'sheet', name: 'Q', hash: 'ab'.repeat(32) } }).code, 'recipe.invalid');
});

test('output, compute and more are checked and keep what is given', () => {
  const r = ok({ recipe: 'collect', v: 1, output: { mode: 'combined', name: '{file.name}__{unit.name}.xlsx', range: null }, compute: 'excel', more: { culture: 'de-DE', limits: { timeoutMs: 1000, maxRows: 50 }, encoding: 'utf-8', csvGuard: false } }).recipe;
  assert.deepEqual(r.output, { mode: 'combined', name: '{file.name}__{unit.name}.xlsx', range: null });
  assert.equal(r.compute, 'excel');
  assert.deepEqual(r.more, { culture: 'de-DE', limits: { timeoutMs: 1000, maxRows: 50 }, encoding: 'utf-8', csvGuard: false });
  assert.equal(bad({ recipe: 'collect', v: 1, output: { mode: 'overwrite', name: 'x' } }).code, 'recipe.invalid');
  assert.equal(bad({ recipe: 'collect', v: 1, output: { mode: 'newFile', name: 5 } }).code, 'recipe.invalid');
  assert.equal(bad({ recipe: 'collect', v: 1, compute: 'cloud' }).code, 'recipe.invalid');
  assert.equal(bad({ recipe: 'collect', v: 1, more: { limits: { timeoutMs: 0 } } }).code, 'recipe.invalid');
  assert.equal(bad({ recipe: 'collect', v: 1, more: { limits: { maxRows: 1.5 } } }).code, 'recipe.invalid');
  assert.equal(bad({ recipe: 'collect', v: 1, more: { csvGuard: 'on' } }).code, 'recipe.invalid');
  assert.equal(bad({ recipe: 'collect', v: 1, more: { encoding: 'latin1' } }).code, 'recipe.invalid');
});

test('the display name is optional and must be a string', () => {
  assert.equal(ok({ recipe: 'collect', v: 1, name: 'East sales' }).recipe.name, 'East sales');
  assert.equal(bad({ recipe: 'collect', v: 1, name: 4 }).code, 'recipe.invalid');
});

test('an invalid recipe says where the problem is', () => {
  const r = bad({ recipe: 'inject', v: 1, inject: { target: 'query', op: 'rename', name: 'Q' } });
  assert.equal(r.code, 'recipe.invalid');
  assert.match(r.detail, /inject\.newName/);
});

test('the four tokens are fixed and any other braces are reported', () => {
  assert.deepEqual(TOKENS, ['{file.name}', '{file.folder}', '{unit.name}', '{unit.index}']);
  assert.deepEqual(unknownTokens('{file.name}__{unit.name}-{unit.index}.xlsx'), []);
  assert.deepEqual(unknownTokens('{file.path}-{unit.name}-{date}'), ['{file.path}', '{date}']);
  assert.deepEqual(unknownTokens('{FILE.NAME}'), ['{FILE.NAME}']);
  assert.deepEqual(unknownTokens('no braces'), []);
  assert.deepEqual(unknownTokens('{ file.name }'), ['{ file.name }']);
  assert.deepEqual(unknownTokens('{file.name}{file.name}'), []);
});

test('a recipe with an unknown token still parses; it is a planning error, not a parse error', () => {
  const r = ok({ recipe: 'collect', v: 1, output: { mode: 'newFile', name: '{date}.xlsx' } });
  assert.deepEqual(unknownTokens(r.recipe.output.name), ['{date}']);
});

test('serialising is stable, indented, ends with a newline and round-trips', () => {
  const src = { v: 1, recipe: 'inject', inject: { text: 'let a = 1 in a', name: 'Q', op: 'add', target: 'query', source: 'inline' }, scope: { match: 'pattern', type: 'sheets', pattern: 'D*' }, name: 'x' };
  const { recipe } = ok(src);
  const text = serialiseRecipe(recipe);
  assert.equal(text.endsWith('}\n'), true);
  assert.match(text, /^\{\n  "recipe": "inject",\n  "v": 1,\n  "name": "x",\n  "scope": \{/);
  assert.deepEqual(parseRecipe(text).recipe, recipe);
  assert.equal(serialiseRecipe(parseRecipe(text).recipe), text);
  assert.equal(serialiseRecipe(parseRecipe(json({ ...src, scope: { type: 'sheets', pattern: 'D*', match: 'pattern' } })).recipe), text);
});

test('a serialised recipe contains no unknown field and no undefined', () => {
  const { recipe } = ok({ recipe: 'collect', v: 1, colour: 'red' });
  const text = serialiseRecipe(recipe);
  assert.equal(text.includes('colour'), false);
  assert.equal(text.includes('undefined'), false);
  assert.equal(text.includes('null,\n'), false);
});

test('parsing does not change the object it was given and parse results are independent', () => {
  const a = parseRecipe(json({ recipe: 'collect', v: 1 }));
  const b = parseRecipe(json({ recipe: 'collect', v: 1 }));
  a.recipe.scope.exclude = ['x'];
  assert.equal('exclude' in b.recipe.scope, false);
});

test('a very large recipe text is refused rather than parsed', () => {
  const r = bad(json({ recipe: 'inject', v: 1, inject: { target: 'query', op: 'add', name: 'Q', text: 'x'.repeat(2 * 1024 * 1024), source: 'inline' } }));
  assert.equal(r.code, 'recipe.invalid');
  assert.match(r.detail, /large/);
});
