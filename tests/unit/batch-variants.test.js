import test from 'node:test';
import assert from 'node:assert/strict';
import { groupVariants, variantKey } from '../../src/batch/verify/variants.js';

const h = (c) => c.repeat(64);
const file = (id, relPath, { queries = [], modules = [], status = 'ready' } = {}) => ({
  id,
  name: relPath.split('/').pop(),
  relPath,
  size: 1,
  status,
  refused: status === 'refused' ? { code: 'file.xls' } : null,
  format: 'xlsx',
  sheets: [],
  tables: [],
  queries: queries.map(([name, hash]) => ({ name, isFunction: false, load: { kind: 'connection' }, hash })),
  modules: modules.map(([name, hash]) => ({ name, kind: 'standard', hash })),
  pq: { editable: true, reason: null },
  vba: { present: modules.length > 0, signed: false, locked: false, writable: true },
  warnings: []
});

test('names are grouped across files and versions by content hash', () => {
  const files = [file('f1', 'a.xlsx', { queries: [['Sales', h('1')]] }), file('f2', 'b.xlsx', { queries: [['Sales', h('1')]] }), file('f3', 'c.xlsx', { queries: [['Sales', h('2')]] })];
  const { items } = groupVariants(files);
  assert.equal(items.length, 1);
  const sales = items[0];
  assert.deepEqual([sales.kind, sales.name, sales.files, sales.versions.length, sales.drift], ['query', 'Sales', 3, 2, true]);
  assert.deepEqual(sales.versions.map((v) => [v.hash, v.count]), [[h('1'), 2], [h('2'), 1]]);
  assert.equal(sales.mostCommon, h('1'));
});

test('a name that is the same everywhere has one version and no drift', () => {
  const { items, drifted } = groupVariants([file('f1', 'a.xlsx', { queries: [['Q', h('1')]] }), file('f2', 'b.xlsx', { queries: [['Q', h('1')]] })]);
  assert.deepEqual([items[0].versions.length, items[0].drift, drifted], [1, false, 0]);
});

test('a name found in only some files counts only those files', () => {
  const { items } = groupVariants([file('f1', 'a.xlsx', { queries: [['Q', h('1')], ['R', h('2')]] }), file('f2', 'b.xlsx', { queries: [['Q', h('1')]] })]);
  assert.deepEqual(items.map((i) => [i.name, i.files]), [['Q', 2], ['R', 1]]);
});

test('queries and modules with the same name are separate items', () => {
  const { items } = groupVariants([file('f1', 'a.xlsm', { queries: [['Same', h('1')]], modules: [['Same', h('2')]] })]);
  assert.deepEqual(items.map((i) => [i.kind, i.name]), [['query', 'Same'], ['module', 'Same']]);
  assert.notEqual(variantKey(items[0]), variantKey(items[1]));
});

test('versions are ordered by file count, then by hash, and the most common wins ties by the lowest hash', () => {
  const files = [file('f1', 'a.xlsx', { queries: [['Q', h('9')]] }), file('f2', 'b.xlsx', { queries: [['Q', h('3')]] }), file('f3', 'c.xlsx', { queries: [['Q', h('5')]] }), file('f4', 'd.xlsx', { queries: [['Q', h('5')]] })];
  const q = groupVariants(files).items[0];
  assert.deepEqual(q.versions.map((v) => [v.hash, v.count]), [[h('5'), 2], [h('3'), 1], [h('9'), 1]]);
  const tie = groupVariants([file('f1', 'a.xlsx', { queries: [['Q', h('9')]] }), file('f2', 'b.xlsx', { queries: [['Q', h('3')]] })]).items[0];
  assert.equal(tie.mostCommon, h('3'));
});

test('each version lists its files in relative path order', () => {
  const files = [file('f3', 'z/c.xlsx', { queries: [['Q', h('1')]] }), file('f1', 'a/a.xlsx', { queries: [['Q', h('1')]] }), file('f2', 'b.xlsx', { queries: [['Q', h('1')]] })];
  assert.deepEqual(groupVariants(files).items[0].versions[0].files, [{ fileId: 'f1', relPath: 'a/a.xlsx' }, { fileId: 'f2', relPath: 'b.xlsx' }, { fileId: 'f3', relPath: 'z/c.xlsx' }]);
});

test('names that differ come first, the most versions first, then by name', () => {
  const files = [
    file('f1', 'a.xlsx', { queries: [['Alpha', h('1')], ['Beta', h('1')], ['Gamma', h('1')], ['Delta', h('1')]] }),
    file('f2', 'b.xlsx', { queries: [['Alpha', h('1')], ['Beta', h('2')], ['Gamma', h('2')], ['Delta', h('1')] ] }),
    file('f3', 'c.xlsx', { queries: [['Gamma', h('3')]] })
  ];
  const { items, drifted } = groupVariants(files);
  assert.deepEqual(items.map((i) => i.name), ['Gamma', 'Beta', 'Alpha', 'Delta']);
  assert.equal(drifted, 2);
});

test('refused files are ignored', () => {
  const { items } = groupVariants([file('f1', 'a.xlsx', { queries: [['Q', h('1')]] }), file('f2', 'old.xls', { status: 'refused' })]);
  assert.equal(items[0].files, 1);
});

test('an empty set has no items', () => {
  assert.deepEqual(groupVariants([]), { items: [], drifted: 0 });
});

test('grouping is deterministic and does not change its input', () => {
  const files = [file('f2', 'b.xlsx', { queries: [['Q', h('2')]] }), file('f1', 'a.xlsx', { queries: [['Q', h('1')]] })];
  const frozen = JSON.stringify(files);
  const a = groupVariants(files);
  const b = groupVariants([...files].reverse());
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(files), frozen);
  assert.deepEqual(structuredClone(a), a);
});

test('five hundred files with twenty names each group quickly', () => {
  const files = Array.from({ length: 500 }, (_, i) => file(`f${i}`, `d${i % 20}/b${i}.xlsx`, { queries: Array.from({ length: 20 }, (_, q) => [`Q${q}`, h(String((i + q) % 4))]) }));
  let ms = Infinity;
  for (let run = 0; run < 5; run++) {
    const t0 = performance.now();
    groupVariants(files);
    ms = Math.min(ms, performance.now() - t0);
  }
  assert.ok(ms < 50, `took ${ms.toFixed(1)} ms`);
});
