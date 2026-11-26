import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRows, chipCounts, searchItems, parseSearch, windowOf, Selection, layerOf, CHIPS } from '../../src/core/wb/nav-model.js';

const mk = (name, extra = {}, i = 0) => ({ name, type: 'query', index: i, status: 'never', refs: 0, usedBy: 0, load: { kind: 'table' }, text: '', steps: [], ...extra });
const ITEMS = [
  mk('Staging_01', { refs: 0, usedBy: 2, status: 'ok', rows: 6 }, 0),
  mk('Sales_Raw', { refs: 0, usedBy: 1, status: 'ok', rows: 6, text: 'let a = Table.Group(x) in a' }, 1),
  mk('Sales_Clean', { refs: 1, usedBy: 2, status: 'stale', edited: true, rows: 5, steps: ['Source', 'Changed Type', 'Merged Queries'], text: 'Table.Group(a)\nTable.Group(b)' }, 2),
  mk('Sales_Summary', { refs: 1, usedBy: 0, status: 'error', rows: null, load: { kind: 'table' } }, 3),
  mk('Sales_Broken', { refs: 1, usedBy: 0, status: 'error', load: { kind: 'connection' } }, 4),
  mk('fx_SalesYear', { isFunction: true, refs: 0, usedBy: 0, status: 'skipped', load: null }, 5),
  mk('Discount', { refs: 0, usedBy: 0, status: 'never', linkedToMacro: true, load: { kind: 'connection' } }, 6)
];
const names = (r) => r.rows.filter((x) => x.kind === 'item').map((x) => x.item.name);

test('T-WB-11: sclean finds Sales_Clean first, and the matched ranges are reported', () => {
  const r = buildRows(ITEMS, { search: 'sclean' });
  assert.equal(names(r)[0], 'Sales_Clean');
  assert.ok(r.rows[0].ranges.length > 0);
});

test('T-WB-11: code: counts occurrences inside the code of each query', () => {
  const r = buildRows(ITEMS, { search: 'code:Table.Group' });
  assert.deepEqual(r.rows.map((x) => [x.item.name, x.matches]), [['Sales_Raw', 1], ['Sales_Clean', 2]]);
  assert.deepEqual(parseSearch('  code: x '), { mode: 'code', query: 'x' });
});

test('T-WB-11: step: finds queries that have a matching step name', () => {
  const r = buildRows(ITEMS, { search: 'step:Merged' });
  assert.deepEqual(r.rows.map((x) => [x.item.name, x.matches]), [['Sales_Clean', 1]]);
});

test('T-WB-11: grouping by layer gives Sources, Staging and Outputs in that order with counts', () => {
  const r = buildRows(ITEMS, { group: 'layer' });
  const groups = r.rows.filter((x) => x.kind === 'group');
  assert.deepEqual(groups.map((g) => [g.group, g.count]), [['sources', 4], ['staging', 1], ['outputs', 2]]);
  assert.equal(layerOf(mk('x', { refs: 2, usedBy: 0 })), 'outputs');
});

test('T-WB-11: group headers carry per-status counts and a collapsed group hides its rows', () => {
  const r = buildRows(ITEMS, { group: 'status' });
  assert.deepEqual(r.rows.filter((x) => x.kind === 'group').map((g) => g.group), ['error', 'stale', 'never', 'ok', 'skipped']);
  assert.deepEqual(r.rows[0].statuses, { error: 2 });
  const c = buildRows(ITEMS, { group: 'status', collapsed: new Set(['error']) });
  assert.equal(c.rows[0].collapsed, true);
  assert.equal(c.rows.filter((x) => x.kind === 'item' && x.item.status === 'error').length, 0);
});

test('T-WB-11: grouping by load target separates tables, connection only and functions', () => {
  const r = buildRows(ITEMS, { group: 'load' });
  assert.deepEqual(r.rows.filter((x) => x.kind === 'group').map((g) => [g.group, g.count]), [['table', 4], ['connection', 2], ['function', 1]]);
});

test('T-WB-11: chips combine with AND and the counts follow the search', () => {
  assert.deepEqual(names(buildRows(ITEMS, { filters: new Set(['errors']) })), ['Sales_Summary', 'Sales_Broken']);
  assert.deepEqual(names(buildRows(ITEMS, { filters: new Set(['errors', 'connection']) })), ['Sales_Broken']);
  assert.deepEqual(names(buildRows(ITEMS, { filters: new Set(['edited', 'stale']) })), ['Sales_Clean']);
  assert.deepEqual(names(buildRows(ITEMS, { filters: new Set(['functions']) })), ['fx_SalesYear']);
  assert.deepEqual(names(buildRows(ITEMS, { filters: new Set(['macro']) })), ['Discount']);
  const all = chipCounts(ITEMS, '');
  assert.deepEqual(Object.keys(all), CHIPS);
  assert.equal(all.errors, 2);
  assert.equal(chipCounts(ITEMS, 'broken').errors, 1);
});

test('T-WB-11: sort by name, rows, and keep the section order by default', () => {
  assert.deepEqual(names(buildRows(ITEMS, { sort: 'name' })).slice(0, 3), ['Discount', 'fx_SalesYear', 'Sales_Broken']);
  assert.equal(names(buildRows(ITEMS, { sort: 'rows' }))[0], 'Staging_01');
  assert.deepEqual(names(buildRows(ITEMS)), ITEMS.map((i) => i.name));
});

test('T-WB-11: unknown chips are ignored and an empty search keeps everything', () => {
  assert.equal(buildRows(ITEMS, { filters: new Set(['nonsense']) }).rows.length, ITEMS.length);
  assert.equal(searchItems(ITEMS, ''), null);
  assert.equal(buildRows(ITEMS, { search: '   ' }).rows.length, ITEMS.length);
});

test('T-WB-11: the window renders only the visible rows plus overscan and keeps the total height', () => {
  const w = windowOf(3000, 4000, 640, 32, 6);
  assert.equal(w.start, 4000 / 32 - 6);
  assert.ok(w.end - w.start <= 20 + 12 + 1);
  assert.equal(w.total, 96000);
  assert.deepEqual(windowOf(5, 0, 640, 32), { start: 0, end: 5, top: 0, total: 160 });
});

test('T-WB-11: multi-select with click, shift range, ctrl toggle, space, extend and select all', () => {
  const keys = ['a', 'b', 'c', 'd', 'e'];
  const s = new Selection();
  assert.deepEqual([...s.click(keys, 'b')], ['b']);
  assert.deepEqual([...s.click(keys, 'd', { shift: true })], ['b', 'c', 'd']);
  assert.deepEqual([...s.click(keys, 'a', { ctrl: true })].sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual([...s.click(keys, 'c', { ctrl: true })].sort(), ['a', 'b', 'd']);
  s.clear();
  s.click(keys, 'b');
  assert.equal(s.extend(keys, 'b', 2), 'd');
  assert.deepEqual([...s.keys], ['b', 'c', 'd']);
  assert.deepEqual([...s.toggle('e')].sort(), ['b', 'c', 'd', 'e']);
  assert.equal(s.selectAll(keys).size, 5);
  s.prune(['a', 'b']);
  assert.deepEqual([...s.keys].sort(), ['a', 'b']);
});

test('T-WB-11: three thousand items build and window in well under 100 ms', () => {
  const items = Array.from({ length: 3000 }, (_, i) => mk(`Query_${i}`, { refs: i % 3, usedBy: i % 2, status: ['ok', 'error', 'stale', 'never'][i % 4], text: 'let x = 1 in x' }, i));
  const t0 = performance.now();
  const r = buildRows(items, { group: 'layer', filters: new Set(['stale']) });
  const s = buildRows(items, { search: 'qry99' });
  const ms = performance.now() - t0;
  assert.ok(r.rows.length > 0 && s.rows.length > 0);
  assert.ok(ms < 100, `took ${ms.toFixed(0)} ms`);
});
