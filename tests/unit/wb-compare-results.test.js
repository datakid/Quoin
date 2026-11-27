import test from 'node:test';
import assert from 'node:assert/strict';
import { schemaDiff, rowDelta, diffCells, cellKey } from '../../src/core/wb/compare-results.js';

const col = (name, type = 'text') => ({ name, type });

test('T-WB-16: the schema diff lists added, removed and retyped columns and says when nothing differs', () => {
  const a = [col('Id', 'number'), col('Name'), col('Old')];
  const b = [col('Id', 'text'), col('Name'), col('New', 'date')];
  const d = schemaDiff(a, b);
  assert.deepEqual(d.added, ['New']);
  assert.deepEqual(d.removed, ['Old']);
  assert.deepEqual(d.retyped, [{ name: 'Id', from: 'number', to: 'text' }]);
  assert.equal(d.same, false);
  assert.equal(schemaDiff(a, a).same, true);
  assert.equal(schemaDiff([{ name: 'x' }], [{ name: 'x', type: 'any' }]).same, true);
});

test('T-WB-16: the row delta is second minus first', () => {
  assert.deepEqual(rowDelta(10, 7), { a: 10, b: 7, delta: -3 });
  assert.equal(rowDelta(0, 0).delta, 0);
});

test('T-WB-16: cells are compared by position, type matters, and null equals null', () => {
  assert.notEqual(cellKey(1), cellKey('1'));
  assert.equal(cellKey(null), cellKey(undefined));
  assert.notEqual(cellKey(true), cellKey('true'));
  assert.equal(cellKey({ k: 'date', days: 5 }), cellKey({ k: 'date', days: 5 }));
  const a = [[1, 'a', null], [2, 'b', 3]];
  const b = [[1, 'x', null], [2, 'b', '3']];
  const d = diffCells(a, b);
  assert.deepEqual(d.cells.map((c) => [c.row, c.col]), [[0, 1], [1, 2]]);
  assert.equal(d.total, 2);
  assert.equal(d.capped, false);
  assert.equal(d.scanned, 2);
});

test('T-WB-16: only the first 200 differing cells are listed but all of them are counted, and uneven tables compare their overlap', () => {
  const a = Array.from({ length: 300 }, (_, i) => [i]);
  const b = Array.from({ length: 300 }, (_, i) => [i + 1]);
  const d = diffCells(a, b);
  assert.equal(d.cells.length, 200);
  assert.equal(d.total, 300);
  assert.equal(d.capped, true);
  const e = diffCells([[1, 2], [3, 4]], [[1]]);
  assert.equal(e.scanned, 1);
  assert.equal(e.total, 0);
});
