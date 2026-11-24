import test from 'node:test';
import assert from 'node:assert/strict';
import { shapeOf, schemaChange, stepDelta, rowsCountable } from '../../src/core/wb/step-delta.js';

const cols = (...pairs) => pairs.map(([name, type]) => ({ name, type: type || 'any' }));
const table = (rows, columns) => ({ kind: 'table', rows, columns });

test('T-WB-14: the shape of a table result keeps its row count and column names and types, other kinds keep their kind', () => {
  const s = shapeOf({ kind: 'table', value: { rowCount: 7, columns: [{ name: 'A', type: 'number', facet: null }, { name: 'B' }] } });
  assert.deepEqual(s, { kind: 'table', rows: 7, columns: [{ name: 'A', type: 'number' }, { name: 'B', type: 'any' }] });
  assert.deepEqual(shapeOf({ kind: 'list', value: { count: 14 } }), { kind: 'list', count: 14 });
  assert.deepEqual(shapeOf({ kind: 'record', value: {} }), { kind: 'record' });
  assert.equal(shapeOf(null), null);
});

test('T-WB-14: rows that go away or arrive are reported with their sign', () => {
  const a = table(1000, cols(['A'], ['B']));
  assert.deepEqual(stepDelta(a, table(688, cols(['A'], ['B']))), { type: 'parts', parts: [{ k: 'rows', n: -312 }] });
  assert.deepEqual(stepDelta(a, table(1005, cols(['A'], ['B']))).parts, [{ k: 'rows', n: 5 }]);
});

test('T-WB-14: an added or removed column is counted', () => {
  const a = table(10, cols(['A'], ['B']));
  assert.deepEqual(stepDelta(a, table(10, cols(['A'], ['B'], ['C']))).parts, [{ k: 'added', n: 1 }]);
  assert.deepEqual(stepDelta(a, table(10, cols(['A']))).parts, [{ k: 'removed', n: 1 }]);
});

test('T-WB-14: a column renamed in place is a rename, not one removed and one added', () => {
  const a = table(10, cols(['A'], ['B'], ['C']));
  assert.deepEqual(stepDelta(a, table(10, cols(['X'], ['B'], ['Y']))).parts, [{ k: 'renamed', n: 2 }]);
  assert.deepEqual(schemaChange(cols(['A'], ['B']), cols(['A'], ['Z'], ['W'])), { added: 1, removed: 0, renamed: 1, types: 0 });
});

test('T-WB-14: changed column types are counted by column', () => {
  const a = table(10, cols(['A', 'any'], ['B', 'any'], ['C', 'text']));
  const b = table(10, cols(['A', 'number'], ['B', 'number'], ['C', 'text']));
  assert.deepEqual(stepDelta(a, b).parts, [{ k: 'types', n: 2 }]);
});

test('T-WB-14: several changes are listed rows first, then columns, renames and types', () => {
  const a = table(10, cols(['A', 'any'], ['B']));
  const b = table(4, cols(['A', 'number'], ['B'], ['C']));
  assert.deepEqual(stepDelta(a, b).parts.map((p) => p.k), ['rows', 'added', 'types']);
});

test('T-WB-14: an unchanged table is schema same, the first table step has a row count, other kinds have their kind', () => {
  const a = table(10, cols(['A'], ['B']));
  assert.deepEqual(stepDelta(a, table(10, cols(['A'], ['B']))), { type: 'same' });
  assert.deepEqual(stepDelta(null, a), { type: 'rows', rows: 10 });
  assert.deepEqual(stepDelta(a, { kind: 'list', count: 14 }), { type: 'kind', kind: 'list', count: 14 });
  assert.deepEqual(stepDelta(a, { kind: 'number' }), { type: 'kind', kind: 'number', count: undefined });
  assert.equal(stepDelta(a, null), null);
});

test('T-WB-14: rows are counted only when the setting is on and the count is within the limit', () => {
  assert.equal(rowsCountable(10), true);
  assert.equal(rowsCountable(2000000), true);
  assert.equal(rowsCountable(2000001), false);
  assert.equal(rowsCountable(10, { countRows: false }), false);
  assert.equal(rowsCountable(5000, { limit: 1000 }), false);
});

test('T-WB-14: a step whose rows are not counted reports only its schema change', () => {
  const a = table(null, cols(['A'], ['B']));
  assert.deepEqual(stepDelta(a, table(null, cols(['A'], ['B']))), { type: 'same' });
  assert.deepEqual(stepDelta(a, table(null, cols(['A'], ['B'], ['C']))).parts, [{ k: 'added', n: 1 }]);
  assert.deepEqual(stepDelta(table(5, cols(['A'])), table(null, cols(['A']))), { type: 'same' });
  assert.deepEqual(stepDelta(null, table(null, cols(['A']))), { type: 'rows', rows: null });
});
