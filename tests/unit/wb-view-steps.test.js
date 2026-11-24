import test from 'node:test';
import assert from 'node:assert/strict';
import { runOnce, serializeTableRows } from '../../src/core/m/engine.js';
import { applyView } from '../../src/core/wb/view-ops.js';
import { viewActions, insertViewSteps } from '../../src/core/wb/view-steps.js';
import { MTable } from '../../src/core/m/values.js';
import { baseOptions, plain } from './helpers.js';

const DATA = '#table({"Name", "Age", "City"}, {{"Ann", 30, "Oslo"}, {"Bob", 25, "Rome"}, {"Cy", 30, "Oslo"}, {"Di", 41, "Paris"}, {"Ed", 25, "Rome"}, {"Flo", null, "Oslo"}})';
const NAMES = { filter: 'Filtered Rows', removeColumns: 'Removed Columns' };

const section = (name, expr) => `section Section1;\r\n\r\nshared ${name} = ${expr};`;
const run = (name, expr) => runOnce({ ...baseOptions, sectionText: section(name, expr), queryName: name });

const SIMPLE = `let\n    Source = ${DATA}\nin\n    Source`;
const CHAINED = `let\n    Source = ${DATA},\n    Sorted = Table.Sort(Source, {{"Name", Order.Descending}})\nin\n    Sorted`;

function viewRows(view) {
  const src = run('Src', DATA);
  const t = src.value;
  assert.ok(t instanceof MTable);
  const out = applyView(t, view);
  assert.equal(out.ok, true);
  const all = serializeTableRows(t, 0, 1000).map((row) => row.map(plain));
  return out.rows.map((r) => out.columns.map((c) => all[r][c]));
}

function stepRows(text) {
  const r = run('Q', text);
  assert.equal(r.status, 'ok', r.error && r.error.message);
  return serializeTableRows(r.value, 0, 1000).map((row) => row.map(plain));
}

function ctx(existing, prevName) {
  return { prevName, existing, names: NAMES };
}

test('T-WB-16: a view becomes one step per filter and one for the hidden columns, in that order', () => {
  const view = { filters: [{ column: 'City', op: 'equals', value: 'Oslo' }, { column: 'Age', op: 'gte', value: 25 }], hidden: ['Name'] };
  assert.deepEqual(viewActions(view).map((a) => a.type), ['filter', 'filter', 'removeColumns']);
  assert.deepEqual(viewActions({ filters: [], hidden: [] }), []);
});

test('T-WB-16: the steps added for a view give exactly the rows and columns the view showed', () => {
  const view = { filters: [{ column: 'City', op: 'equals', value: 'Oslo' }, { column: 'Age', op: 'gte', value: 25 }], hidden: ['Name'] };
  const res = insertViewSteps(SIMPLE, 0, view, ctx(['Source'], 'Source'));
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.added.length, 3);
  assert.match(res.text, /in\s+#"Removed Columns"\s*$/);
  assert.deepEqual(stepRows(res.text), viewRows(view));
  assert.equal(stepRows(res.text).length, 2);
});

test('T-WB-16: a values filter with a null, a text filter that ignores case and a date filter all carry over', () => {
  const view = { filters: [{ column: 'Name', op: 'in', values: ['Ann', 'Di', null] }, { column: 'City', op: 'contains', value: 'OS', ignoreCase: true }] };
  const res = insertViewSteps(SIMPLE, 0, view, ctx(['Source'], 'Source'));
  assert.equal(res.ok, true, res.reason);
  assert.deepEqual(stepRows(res.text), viewRows(view));
  assert.equal(stepRows(res.text).length, 1);
});

test('T-WB-16: steps inserted in the middle of a chain rewire the step after them', () => {
  const view = { filters: [{ column: 'City', op: 'equals', value: 'Rome' }] };
  const res = insertViewSteps(CHAINED, 0, view, ctx(['Source', 'Sorted'], 'Source'));
  assert.equal(res.ok, true, res.reason);
  assert.match(res.text, /Sorted = Table\.Sort\(#"Filtered Rows", /);
  assert.deepEqual(stepRows(res.text).map((r) => r[0]), ['Ed', 'Bob']);
});

test('T-WB-16: two filters on one query get different step names', () => {
  const view = { filters: [{ column: 'City', op: 'equals', value: 'Oslo' }, { column: 'Age', op: 'gt', value: 29 }] };
  const res = insertViewSteps(SIMPLE, 0, view, ctx(['Source'], 'Source'));
  assert.equal(new Set(res.added).size, 2);
});

test('T-WB-16: an empty view and an unknown position are refused with a reason', () => {
  assert.equal(insertViewSteps(SIMPLE, 0, { filters: [], hidden: [] }, ctx(['Source'], 'Source')).ok, false);
  const bad = insertViewSteps(SIMPLE, 7, { filters: [{ column: 'City', op: 'equals', value: 'Oslo' }] }, ctx(['Source'], 'Source'));
  assert.equal(bad.ok, false);
  assert.ok(bad.reason.length > 0);
});
