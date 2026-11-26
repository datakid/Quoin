import test from 'node:test';
import assert from 'node:assert/strict';
import { summariesFor, stepLines, procedureLines } from '../../src/app/change-summary.js';
import { moveStep, insertStepAfter, bypassStep } from '../../src/core/wb/let-edit.js';

const BASE = 'let\n  Source = Table.FromRows({{1}}),\n  A = Table.SelectRows(Source, each [x] > 0),\n  B = Table.Sort(A, {{"x", Order.Ascending}}),\n  C = Table.Distinct(B)\nin\n  C';

test('T-WB-26: the summary reads in the words of the plan', () => {
  let t = moveStep(BASE, 3, 1, { rewire: true }).text;
  t = insertStepAfter(t, 0, 'Typed', 'Table.TransformColumnTypes(Source, {{"x", type number}})', { rewire: true }).text;
  t = bypassStep(t, 3).text;
  assert.deepEqual(stepLines(BASE, t), ['Steps reordered: C moved above A', 'Step added: Typed', 'Step bypassed: A']);
});

test('T-WB-26: the last step moved to the end and an unchanged query', () => {
  assert.deepEqual(stepLines(BASE, BASE), []);
  const m = moveStep(BASE, 1, 3, { rewire: true });
  assert.equal(stepLines(BASE, m.text)[0], 'Steps reordered: A moved to the end');
});

test('T-WB-26: modules summarise procedures, and a change set maps every item', () => {
  const o = 'Sub A()\n  x = 1\nEnd Sub\nSub B()\nEnd Sub';
  const c = 'Sub A()\n  x = 2\nEnd Sub\nSub D()\nEnd Sub';
  assert.deepEqual(procedureLines(o, c, 'standard'), ['Procedures changed: A', 'Procedures added: D', 'Procedures removed: B']);
  const map = summariesFor({ queries: new Map([['Q', { original: BASE, current: BASE }]]), modules: new Map([['M', { original: o, current: c }]]) }, () => 'standard');
  assert.deepEqual([...map.keys()], ['Q', 'M']);
  assert.equal(map.get('M').length, 3);
});
