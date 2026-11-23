import test from 'node:test';
import assert from 'node:assert/strict';
import { profileColumn, distinctLabel, DISTINCT_CAP } from '../../src/core/wb/profile.js';

const over = (values, extra = {}) => profileColumn({ count: values.length, at: (r) => values[r], ...extra });

test('T-WB-16: a numeric column reports count, nulls, errors, distinct, min, max and mean', () => {
  const p = over([1, 2, 2, 3, null, { k: 'error', reason: 'Expression.Error', message: 'x' }, 4]);
  assert.equal(p.count, 7);
  assert.equal(p.nulls, 1);
  assert.equal(p.errors, 1);
  assert.equal(p.filled, 5);
  assert.equal(p.distinct, 4);
  assert.equal(p.min, 1);
  assert.equal(p.max, 4);
  assert.equal(p.mean, 2.4);
  assert.equal(p.mixed, false);
});

test('T-WB-16: the top values are ranked by count, ties keep first-seen order, and carry their share', () => {
  const p = over(['b', 'a', 'b', 'c', 'a', 'b', 'd', 'e', 'f', 'g']);
  assert.deepEqual(p.top.map((t) => [t.text, t.count]), [['b', 3], ['a', 2], ['c', 1], ['d', 1], ['e', 1]]);
  assert.equal(p.top.length, 5);
  assert.equal(p.top[0].share, 0.3);
});

test('T-WB-16: a text column reports its length range and has no numeric statistics', () => {
  const p = over(['ab', 'abcde', '', null]);
  assert.equal(p.lengthMin, 0);
  assert.equal(p.lengthMax, 5);
  assert.equal(p.min, null);
  assert.equal(p.mean, null);
  assert.equal(p.nulls, 1);
});

test('T-WB-16: numbers and text in one column are reported as mixed with a count for each kind', () => {
  const p = over([1, 'x', 2, 'y', 'z']);
  assert.equal(p.mixed, true);
  assert.deepEqual(p.kinds, [{ kind: 'text', count: 3 }, { kind: 'number', count: 2 }]);
  assert.equal(p.mean, 1.5);
  assert.equal(p.lengthMax, 1);
});

test('T-WB-16: 1 and "1" are different values, and so are true and "true"', () => {
  assert.equal(over([1, '1', true, 'true']).distinct, 4);
});

test('T-WB-16: special numbers count as numbers but stay out of min, max and mean', () => {
  const p = over([1, { k: 'number', special: 'NaN' }, { k: 'number', special: 'Infinity' }, 3]);
  assert.equal(p.kinds.find((k) => k.kind === 'number').count, 4);
  assert.equal(p.min, 1);
  assert.equal(p.max, 3);
  assert.equal(p.mean, 2);
  assert.equal(p.distinct, 4);
});

test('T-WB-16: dates report earliest and latest by their ISO text', () => {
  const d = (text) => ({ k: 'date', text, ticks: '0' });
  const p = over([d('2024-03-05'), d('2023-12-31'), d('2024-01-01'), null]);
  assert.equal(p.earliest, '2023-12-31');
  assert.equal(p.latest, '2024-03-05');
  assert.equal(p.min, null);
  assert.equal(p.distinct, 3);
});

test('T-WB-16: the distinct count stops at the cap and says so', () => {
  const n = DISTINCT_CAP + 500;
  const p = profileColumn({ count: n, at: (r) => r });
  assert.equal(p.distinct, DISTINCT_CAP);
  assert.equal(p.distinctCapped, true);
  assert.equal(p.topApproximate, true);
  assert.equal(distinctLabel(p, (x) => x.toLocaleString('en-US')), '10,000+');
  assert.equal(distinctLabel(over([1, 2]), String), '2');
  assert.equal(over([1, 2]).distinctCapped, false);
});

test('T-WB-16: an empty column and an all-null column profile without dividing by zero', () => {
  const empty = over([]);
  assert.equal(empty.count, 0);
  assert.equal(empty.top.length, 0);
  assert.equal(empty.mean, null);
  const nulls = over([null, undefined]);
  assert.equal(nulls.nulls, 2);
  assert.equal(nulls.filled, 0);
  assert.equal(nulls.top.length, 0);
});

test('T-WB-16: profiling a million rows stays well under a second', () => {
  const t0 = performance.now();
  const p = profileColumn({ count: 1000000, at: (r) => r % 997 });
  assert.equal(p.distinct, 997);
  assert.ok(performance.now() - t0 < 1000);
});
