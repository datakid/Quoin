import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlan } from '../../src/batch/resolve/resolve.js';
import { parseRecipe } from '../../src/batch/recipe/recipe.js';

const NOW = '2026-11-14T10:00:00.000Z';

const injectRecipe = (inject, extra = {}) => {
  const parsed = parseRecipe(JSON.stringify({ recipe: 'inject', v: 1, inject: { source: 'inline', text: 'let a = 1 in a', ...inject }, ...extra }));
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  return parsed.recipe;
};

const book = (id, relPath, { queries = [], modules = [] } = {}) => ({
  id,
  name: relPath.split('/').pop(),
  relPath,
  size: 10,
  status: 'ready',
  refused: null,
  format: 'xlsm',
  sheets: [],
  tables: [],
  queries: queries.map((name) => ({ name, isFunction: false, load: { kind: 'connectionOnly' }, hash: 'h' })),
  modules: modules.map((name) => ({ name, kind: 'standard', hash: 'h' })),
  pq: { editable: true, reason: null },
  vba: { present: true, signed: false, locked: false, writable: true },
  warnings: []
});

const actionsOf = (plan, fileId = plan.files[0].fileId) => plan.files.find((f) => f.fileId === fileId).actions.map((a) => [a.op, a.target.type, a.target.name]);

test('an inject recipe gives each file one workbook unit and one action on the named target', () => {
  const plan = resolvePlan(injectRecipe({ target: 'query', op: 'replace', name: 'Sales' }), [book('f1', 'dir/a.xlsx', { queries: ['Sales', 'Other'] })], { now: NOW });
  assert.deepEqual(plan.files[0].units, [{ fileId: 'f1', kind: 'workbook', name: 'a', index: 1 }]);
  assert.deepEqual(plan.files[0].actions, [{ unit: plan.files[0].units[0], op: 'replace', target: { type: 'query', name: 'Sales' }, compute: null, output: null, replaces: null }]);
  assert.deepEqual([plan.files[0].source, plan.files[0].skipped, plan.errors], ['rule', null, []]);
});

test('add, replace, rename and remove each become the action of the same name', () => {
  for (const op of ['add', 'replace', 'rename', 'remove']) {
    const recipe = injectRecipe({ target: 'query', op, name: 'Sales', ...(op === 'rename' ? { newName: 'Sales2' } : {}) });
    assert.deepEqual(actionsOf(resolvePlan(recipe, [book('f1', 'a.xlsx', { queries: ['Sales'] })], { now: NOW })), [[op, 'query', 'Sales']]);
  }
});

test('a target that the file does not have still gets its action, so the run can report it as not applicable', () => {
  const plan = resolvePlan(injectRecipe({ target: 'query', op: 'replace', name: 'Sales' }), [book('f1', 'a.xlsx', { queries: ['Other'] }), book('f2', 'b.xlsx')], { now: NOW });
  assert.deepEqual(actionsOf(plan, 'f1'), [['replace', 'query', 'Sales']]);
  assert.deepEqual(actionsOf(plan, 'f2'), [['replace', 'query', 'Sales']]);
});

test('a module target uses the module type and ignores the file queries', () => {
  const plan = resolvePlan(injectRecipe({ target: 'module', op: 'replace', name: 'Helpers' }), [book('f1', 'a.xlsm', { queries: ['Helpers'], modules: ['Helpers'] })], { now: NOW });
  assert.deepEqual(actionsOf(plan), [['replace', 'module', 'Helpers']]);
});

test('a name pattern expands over the queries the file has, in the file order and without regard to case', () => {
  const recipe = injectRecipe({ target: 'query', op: 'remove', match: 'pattern', name: 'old*' });
  const plan = resolvePlan(recipe, [book('f1', 'a.xlsx', { queries: ['Keep', 'OldB', 'oldA', 'Newer', 'Old'] })], { now: NOW });
  assert.deepEqual(actionsOf(plan), [['remove', 'query', 'OldB'], ['remove', 'query', 'oldA'], ['remove', 'query', 'Old']]);
  assert.deepEqual(plan.summary, { files: 1, units: 1, groups: [{ unitsPerFile: 1, files: 1 }] });
});

test('a name pattern over modules uses the modules of the file', () => {
  const plan = resolvePlan(injectRecipe({ target: 'module', op: 'remove', match: 'pattern', name: 'Mod?' }), [book('f1', 'a.xlsm', { queries: ['ModA'], modules: ['ModA', 'ModBB', 'ModC'] })], { now: NOW });
  assert.deepEqual(actionsOf(plan), [['remove', 'module', 'ModA'], ['remove', 'module', 'ModC']]);
});

test('a file where a pattern matches nothing is skipped with the pattern as detail and is not counted', () => {
  const plan = resolvePlan(injectRecipe({ target: 'query', op: 'replace', match: 'pattern', name: 'Sales*' }), [book('f1', 'a.xlsx', { queries: ['Sales1'] }), book('f2', 'b.xlsx', { queries: ['Other'] })], { now: NOW });
  const none = plan.files.find((f) => f.fileId === 'f2');
  assert.deepEqual([none.units, none.actions, none.skipped], [[], [], { code: 'skip.notApplicable', detail: 'Sales*' }]);
  assert.deepEqual(plan.summary, { files: 1, units: 1, groups: [{ unitsPerFile: 1, files: 1 }] });
  assert.deepEqual(plan.errors, []);
});

test('add never expands: its name is literal, and a pattern on an add is a planning error', () => {
  const plan = resolvePlan(injectRecipe({ target: 'query', op: 'add', match: 'pattern', name: 'New*' }), [book('f1', 'a.xlsx', { queries: ['NewA'] })], { now: NOW });
  assert.deepEqual(actionsOf(plan), [['add', 'query', 'New*']]);
  assert.deepEqual(plan.errors, [{ code: 'recipe.patternAdd', detail: 'New*' }]);
});

test('a refused file is skipped with its own reason and has no actions', () => {
  const refused = { ...book('f1', 'old.xls'), status: 'refused', refused: { code: 'file.unsupportedExtension' } };
  const plan = resolvePlan(injectRecipe({ target: 'query', op: 'add', name: 'Q' }), [refused], { now: NOW });
  assert.deepEqual([plan.files[0].units, plan.files[0].actions, plan.files[0].skipped], [[], [], { code: 'file.unsupportedExtension', detail: null }]);
});

test('a sheet scope does not change an inject plan: the unit is always the workbook', () => {
  const plan = resolvePlan(injectRecipe({ target: 'query', op: 'add', name: 'Q' }, { scope: { type: 'sheets', match: 'all' } }), [book('f1', 'a.xlsx')], { now: NOW });
  assert.deepEqual(plan.files[0].units.map((u) => u.kind), ['workbook']);
});

test('pins are matched as for collect: an absent file is an orphan and a present one is untouched', () => {
  const overrides = [{ file: 'gone.xlsx', path: 'x/gone.xlsx', units: ['A'] }, { file: 'a.xlsx', path: 'a.xlsx', units: ['A'] }];
  const plan = resolvePlan(injectRecipe({ target: 'query', op: 'add', name: 'Q' }, { overrides }), [book('f1', 'a.xlsx')], { now: NOW });
  assert.deepEqual(plan.orphanPins, [{ file: 'x/gone.xlsx', units: ['A'] }]);
  assert.equal(plan.files[0].source, 'rule');
});

test('an inject plan is deterministic, ignores input order, leaves its inputs alone and survives structured clone', () => {
  const files = [book('f2', 'b.xlsx', { queries: ['Sales'] }), book('f1', 'a.xlsx', { queries: ['Sales', 'Sales2'] })];
  const frozen = JSON.stringify(files);
  const recipe = injectRecipe({ target: 'query', op: 'replace', match: 'pattern', name: 'Sales*' });
  const a = resolvePlan(recipe, files, { now: NOW });
  assert.deepEqual(a, resolvePlan(recipe, [...files].reverse(), { now: NOW }));
  assert.equal(JSON.stringify(files), frozen);
  assert.deepEqual(structuredClone(a), a);
});

test('replace-in-code and align recipes are still not resolved here', () => {
  const find = parseRecipe(JSON.stringify({ recipe: 'replace', v: 1, replace: { in: ['m'], find: 'a', with: 'b' } })).recipe;
  assert.throws(() => resolvePlan(find, [], { now: NOW }), /replace/);
  const align = parseRecipe(JSON.stringify({ recipe: 'align', v: 1, align: { target: 'query', name: 'Q', hash: 'a'.repeat(64) } })).recipe;
  assert.throws(() => resolvePlan(align, [], { now: NOW }), /align/);
});
