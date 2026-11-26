import test from 'node:test';
import assert from 'node:assert/strict';
import { OpHistory, HISTORY_LIMIT } from '../../src/core/wb/op-history.js';

test('T-WB-15: each operation is recorded with its label, before and after text, and an unchanged text is not', () => {
  const h = new OpHistory();
  assert.equal(h.record('Moved A', 'v1', 'v2').label, 'Moved A');
  assert.equal(h.record('Nothing', 'v2', 'v2'), null);
  assert.equal(h.size, 1);
  assert.deepEqual([h.latest().before, h.latest().after], ['v1', 'v2']);
});

test('T-WB-15: undo is offered only while the text is still the result of the last operation', () => {
  const h = new OpHistory();
  assert.equal(h.undoable('v1'), null);
  h.record('Deleted B', 'v1', 'v2');
  assert.equal(h.undoable('v2').before, 'v1');
  assert.equal(h.undoable('v2 edited by hand'), null);
});

test('T-WB-15: the versions list runs newest first and ends with the text before the first operation', () => {
  const h = new OpHistory();
  h.record('one', 'v1', 'v2', 10);
  h.record('two', 'v2', 'v3', 20);
  h.record('three', 'v3', 'v4', 30);
  assert.deepEqual(h.versions().map((v) => [v.label, v.text]), [['three', 'v4'], ['two', 'v3'], ['one', 'v2'], [null, 'v1']]);
  assert.deepEqual(new OpHistory().versions(), []);
});

test('T-WB-15: the history keeps the last 50 operations and drops the oldest', () => {
  const h = new OpHistory();
  for (let i = 0; i < 60; i++) h.record(`op ${i}`, `t${i}`, `t${i + 1}`);
  assert.equal(h.size, HISTORY_LIMIT);
  assert.equal(h.versions().length, HISTORY_LIMIT + 1);
  assert.equal(h.versions()[HISTORY_LIMIT].text, 't10');
  assert.equal(h.latest().label, 'op 59');
});
