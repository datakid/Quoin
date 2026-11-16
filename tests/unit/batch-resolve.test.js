import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlan } from '../../src/batch/resolve/resolve.js';
import { parseRecipe } from '../../src/batch/recipe/recipe.js';

const NOW = '2026-11-14T10:00:00.000Z';
const collect = (extra = {}) => parseRecipe(JSON.stringify({ recipe: 'collect', v: 1, ...extra })).recipe;

const hash = (c) => c.repeat(64);
const ready = (id, relPath, { queries = [], modules = [] } = {}) => ({
  id,
  name: relPath.split('/').pop(),
  relPath,
  size: 10,
  status: 'ready',
  refused: null,
  format: 'xlsx',
  sheets: [],
  tables: [],
  queries: queries.map((q, i) => ({ name: q, isFunction: false, load: { kind: 'connection' }, hash: hash(String(i % 10)) })),
  modules: modules.map((m, i) => ({ name: m, kind: 'standard', hash: hash(String((i + 3) % 10)) })),
  pq: { editable: true, reason: null },
  vba: { present: modules.length > 0, signed: false, locked: false, writable: true },
  warnings: []
});
const refused = (id, relPath, code) => ({ ...ready(id, relPath), status: 'refused', refused: { code }, format: null });

test('a collect plan has one workbook unit per ready file, in relative path order', () => {
  const files = [ready('f2', 'b/second.xlsx', { queries: ['Q'] }), ready('f1', 'a/first.xlsm', { queries: ['Q1', 'Q2'], modules: ['Module1'] })];
  const plan = resolvePlan(collect(), files, { now: NOW });
  assert.deepEqual(plan.files.map((f) => f.fileId), ['f1', 'f2']);
  assert.deepEqual(plan.files[0].units, [{ fileId: 'f1', kind: 'workbook', name: 'first', index: 1 }]);
  assert.deepEqual(plan.files[1].units, [{ fileId: 'f2', kind: 'workbook', name: 'second', index: 1 }]);
  assert.equal(plan.files[0].source, 'rule');
  assert.equal(plan.files[0].skipped, null);
});

test('each query and module of a ready file becomes one collect action on its unit', () => {
  const plan = resolvePlan(collect(), [ready('f1', 'a.xlsm', { queries: ['Q1', 'Q2'], modules: ['Module1', 'Sheet1'] })], { now: NOW });
  const actions = plan.files[0].actions;
  assert.deepEqual(actions.map((a) => [a.op, a.target.type, a.target.name]), [['collect', 'query', 'Q1'], ['collect', 'query', 'Q2'], ['collect', 'module', 'Module1'], ['collect', 'module', 'Sheet1']]);
  for (const a of actions) {
    assert.deepEqual(a.unit, plan.files[0].units[0]);
    assert.deepEqual([a.compute, a.output, a.replaces], [null, null, null]);
  }
});

test('a ready file with nothing to collect still counts as usable and has no actions', () => {
  const plan = resolvePlan(collect(), [ready('f1', 'empty.xlsx')], { now: NOW });
  assert.equal(plan.files[0].units.length, 1);
  assert.deepEqual(plan.files[0].actions, []);
  assert.equal(plan.files[0].skipped, null);
  assert.equal(plan.summary.files, 1);
});

test('a refused file has no units and carries its reason', () => {
  const plan = resolvePlan(collect(), [refused('f1', 'old.xls', 'file.unsupportedExtension'), ready('f2', 'ok.xlsx')], { now: NOW });
  const r = plan.files.find((f) => f.fileId === 'f1');
  assert.deepEqual([r.units, r.actions, r.skipped], [[], [], { code: 'file.unsupportedExtension', detail: null }]);
  assert.equal(plan.summary.files, 1);
  assert.equal(plan.summary.units, 1);
});

test('the summary counts usable files and units and groups files by units per file', () => {
  const files = [ready('f1', 'a.xlsx'), ready('f2', 'b.xlsx'), ready('f3', 'c.xlsx'), refused('f4', 'd.xls', 'file.unsupportedExtension')];
  const plan = resolvePlan(collect(), files, { now: NOW });
  assert.deepEqual(plan.summary, { files: 3, units: 3, groups: [{ unitsPerFile: 1, files: 3 }] });
});

test('the plan records the recipe, the frozen time and who made it', () => {
  const recipe = collect({ name: 'Inventory' });
  const plan = resolvePlan(recipe, [], { now: NOW });
  assert.deepEqual([plan.recipe, plan.now, plan.createdBy], [recipe, NOW, 'resolve']);
  assert.deepEqual([plan.files, plan.orphanPins, plan.errors], [[], [], []]);
  assert.deepEqual(plan.summary, { files: 0, units: 0, groups: [] });
});

test('the time has to be a frozen ISO UTC time', () => {
  for (const now of [undefined, 'today', '2026-11-14', 5, '2026-11-14T10:00:00+02:00']) assert.throws(() => resolvePlan(collect(), [], { now }), /now/);
});

test('only collect is resolved in this phase', () => {
  const recipe = parseRecipe(JSON.stringify({ recipe: 'align', v: 1, align: { target: 'query', name: 'Q', hash: 'a'.repeat(64) } })).recipe;
  assert.throws(() => resolvePlan(recipe, [], { now: NOW }), /align/);
});

test('an override for a file that is not in the set is reported as an orphan pin', () => {
  const recipe = collect({ overrides: [{ file: 'gone.xlsx', path: 'east/gone.xlsx', units: ['Data'] }, { file: 'here.xlsx', path: 'here.xlsx', units: ['Data'] }] });
  const plan = resolvePlan(recipe, [ready('f1', 'here.xlsx')], { now: NOW });
  assert.deepEqual(plan.orphanPins, [{ file: 'east/gone.xlsx', units: ['Data'] }]);
});

test('an unknown token in the output name is a planning error naming the token', () => {
  const plan = resolvePlan(collect({ output: { mode: 'newFile', name: '{file.name}-{date}.xlsx' } }), [ready('f1', 'a.xlsx')], { now: NOW });
  assert.deepEqual(plan.errors, [{ code: 'recipe.token', detail: '{date}' }]);
  assert.equal(plan.files.length, 1);
});

test('known tokens are not errors', () => {
  const plan = resolvePlan(collect({ output: { mode: 'newFile', name: '{file.folder}{file.name}__{unit.name}-{unit.index}.xlsx' } }), [ready('f1', 'a.xlsx')], { now: NOW });
  assert.deepEqual(plan.errors, []);
});

test('planning is deterministic, independent of input order and does not change its inputs', () => {
  const files = [ready('f3', 'c.xlsx', { queries: ['Q'] }), ready('f1', 'a.xlsx'), refused('f2', 'b.xls', 'file.unsupportedExtension')];
  const frozen = JSON.stringify(files);
  const a = resolvePlan(collect(), files, { now: NOW });
  const b = resolvePlan(collect(), [...files].reverse(), { now: NOW });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(files), frozen);
  assert.equal(JSON.stringify(a), JSON.stringify(resolvePlan(collect(), files, { now: NOW })));
  assert.deepEqual(structuredClone(a), a);
});

test('files with the same relative path keep their order of id', () => {
  const plan = resolvePlan(collect(), [ready('f2', 'a.xlsx'), ready('f1', 'a.xlsx')], { now: NOW });
  assert.deepEqual(plan.files.map((f) => f.fileId), ['f1', 'f2']);
});

test('a file index that is neither ready nor refused is rejected', () => {
  assert.throws(() => resolvePlan(collect(), [{ ...ready('f1', 'a.xlsx'), status: 'pending' }], { now: NOW }), /status/);
});
