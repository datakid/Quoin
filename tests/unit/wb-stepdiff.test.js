import test from 'node:test';
import assert from 'node:assert/strict';
import { diffSteps, diffProcedures } from '../../src/core/wb/step-diff.js';
import { moveStep, insertStepAfter, bypassStep, renameStep, deleteStep } from '../../src/core/wb/let-edit.js';

const BASE = 'let\n  Source = Table.FromRows({{1}}),\n  A = Table.SelectRows(Source, each [x] > 0),\n  B = Table.Sort(A, {{"x", Order.Ascending}}),\n  C = Table.Distinct(B),\n  D = Table.FirstN(C, 5)\nin\n  D';

const rows = (o, c) => diffSteps(o, c).rows.map((r) => [r.kind, r.step, r.before]);

test('T-WB-26: identical queries have no differences', () => {
  assert.deepEqual(rows(BASE, BASE), []);
});

test('T-WB-26: a single move is one reordered row naming the step it now sits above', () => {
  const moved = moveStep(BASE, 3, 1, { rewire: true });
  assert.equal(moved.ok, true);
  assert.deepEqual(rows(BASE, moved.text), [['reordered', 'C', 'A']]);
});

test('T-WB-26: moving the last step up and moving it to the end read the same way', () => {
  const m = moveStep(BASE, 4, 2, { rewire: true });
  assert.deepEqual(rows(BASE, m.text), [['reordered', 'D', 'B']]);
});

test('T-WB-26: reorder, insert and bypass give exactly those three rows and no rewire noise', () => {
  let t = moveStep(BASE, 3, 1, { rewire: true }).text;
  t = insertStepAfter(t, 0, 'Typed', 'Table.TransformColumnTypes(Source, {{"x", type number}})', { rewire: true }).text;
  t = bypassStep(t, 4).text;
  const r = rows(BASE, t);
  assert.deepEqual(r.map((x) => [x[0], x[1]]), [['reordered', 'C'], ['added', 'Typed'], ['bypassed', 'B']]);
});

test('T-WB-26: a deleted step is listed as removed and a restored bypass as restored', () => {
  const del = deleteStep(BASE, 3).text;
  assert.deepEqual(rows(BASE, del), [['removed', 'C', undefined]]);
  const byp = bypassStep(BASE, 2).text;
  assert.deepEqual(rows(byp, BASE).map((x) => [x[0], x[1]]), [['restored', 'B']]);
});

test('T-WB-26: an edited expression is a change, a renamed reference alone is not', () => {
  const edited = BASE.replace('each [x] > 0', 'each [x] > 10');
  assert.deepEqual(rows(BASE, edited).map((x) => [x[0], x[1]]), [['changed', 'A']]);
  const renamed = renameStep(BASE, 1, 'Positive').text;
  assert.deepEqual(rows(BASE, renamed).map((x) => [x[0], x[1]]), [['added', 'Positive'], ['removed', 'A']]);
});

test('T-WB-26: queries that are not let blocks are not comparable', () => {
  assert.deepEqual(diffSteps('1 + 2', '1 + 3'), { comparable: false, rows: [] });
  assert.equal(diffSteps(BASE, 'let in').comparable, false);
});

test('T-WB-26: procedures are summarised as edited, added and removed', () => {
  const o = 'Sub A()\r\n  x = 1\r\nEnd Sub\r\nSub B()\r\nEnd Sub\r\nSub C()\r\nEnd Sub';
  const c = 'Sub A()\r\n  x = 2\r\nEnd Sub\r\nSub C()\r\nEnd Sub\r\nSub D()\r\nEnd Sub';
  assert.deepEqual(diffProcedures(o, c), { edited: ['A'], added: ['D'], removed: ['B'] });
});
