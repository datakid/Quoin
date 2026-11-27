import test from 'node:test';
import assert from 'node:assert/strict';
import { runOnce, serializeTableRows } from '../../src/core/m/engine.js';
import { generateStep } from '../../src/core/wb/m-gen.js';
import { applyView, isViewEmpty, viewValue } from '../../src/core/wb/view-ops.js';
import { MTable } from '../../src/core/m/values.js';
import { baseOptions, plain } from './helpers.js';

const NAMES = { filter: 'Filtered Rows', sort: 'Sorted Rows' };

const SOURCE = '#table({"Id", "Name", "Qty", "Day", "Flag"}, {{1, "Alpha", 10, #date(2024, 3, 5), true}, {2, "beta", null, #date(2023, 12, 31), false}, {3, "Alphabet", 7, null, true}, {4, null, 10, #date(2024, 1, 1), null}, {5, "ALPHA", 3, #date(2024, 3, 5), false}, {6, "gamma", 7, #date(2022, 6, 30), true}})';

const section = (...members) => `section Section1;\r\n\r\n${members.map(([n, e]) => `shared ${n} = ${e};`).join('\r\n\r\n')}`;
const run = (text, queryName) => runOnce({ ...baseOptions, sectionText: text, queryName });

function sourceTable() {
  const r = run(section(['Src', SOURCE]), 'Src');
  assert.equal(r.status, 'ok');
  assert.ok(r.value instanceof MTable);
  return r.value;
}

function viaEngine(action) {
  const step = generateStep(action, { prev: 'Src', existing: [], names: NAMES });
  const r = run(section(['Src', SOURCE], ['Q', step.expr]), 'Q');
  if (r.status !== 'ok') return { ok: false, message: r.error && r.error.message };
  return { ok: true, rows: serializeTableRows(r.value, 0, 1000).map((row) => row.map(plain)) };
}

function viaView(view) {
  const t = sourceTable();
  const out = applyView(t, view);
  if (!out.ok) return out;
  const all = serializeTableRows(t, 0, 1000).map((row) => row.map(plain));
  return { ok: true, rows: out.rows.map((i) => all[i]) };
}

const filterCases = [
  ['equals a number', { column: 'Qty', op: 'equals', value: 10 }],
  ['equals null', { column: 'Qty', op: 'equals', value: null }],
  ['not equals a number', { column: 'Qty', op: 'notEquals', value: 10 }],
  ['greater than', { column: 'Qty', op: 'gt', value: 7 }],
  ['at least', { column: 'Qty', op: 'gte', value: 7 }],
  ['less than', { column: 'Qty', op: 'lt', value: 10 }],
  ['at most', { column: 'Qty', op: 'lte', value: 7 }],
  ['is null', { column: 'Name', op: 'isNull' }],
  ['is not null', { column: 'Name', op: 'isNotNull' }],
  ['contains', { column: 'Name', op: 'contains', value: 'lpha' }],
  ['contains ignoring case', { column: 'Name', op: 'contains', value: 'alpha', ignoreCase: true }],
  ['begins with', { column: 'Name', op: 'beginsWith', value: 'Alpha' }],
  ['begins with ignoring case', { column: 'Name', op: 'beginsWith', value: 'alpha', ignoreCase: true }],
  ['ends with', { column: 'Name', op: 'endsWith', value: 'a' }],
  ['ends with ignoring case', { column: 'Name', op: 'endsWith', value: 'A', ignoreCase: true }],
  ['in a list', { column: 'Name', op: 'in', values: ['Alpha', 'gamma', null] }],
  ['date equals', { column: 'Day', op: 'equals', value: { date: '2024-03-05' } }],
  ['date after', { column: 'Day', op: 'gt', value: { date: '2024-01-01' } }],
  ['logical equals', { column: 'Flag', op: 'equals', value: true }],
  ['empty text contains', { column: 'Name', op: 'contains', value: '' }]
];

for (const [label, spec] of filterCases) {
  test(`T-WB-16: view filter "${label}" returns the rows the generated step returns`, () => {
    const engine = viaEngine({ type: 'filter', ...spec });
    const view = viaView({ filters: [spec] });
    assert.equal(engine.ok, true, engine.message);
    assert.deepEqual(view, engine);
  });
}

test('T-WB-16: a filter that compares a column of numbers with text fails in the view as it does in the engine', () => {
  const spec = { column: 'Qty', op: 'gt', value: 'x' };
  const engine = viaEngine({ type: 'filter', ...spec });
  const view = viaView({ filters: [spec] });
  assert.equal(engine.ok, false);
  assert.equal(view.ok, false);
  assert.ok(view.message.length > 0);
});

const sortCases = [
  ['numbers ascending', [{ name: 'Qty' }]],
  ['numbers descending', [{ name: 'Qty', descending: true }]],
  ['text ascending', [{ name: 'Name' }]],
  ['text descending', [{ name: 'Name', descending: true }]],
  ['dates ascending', [{ name: 'Day' }]],
  ['two columns', [{ name: 'Qty', descending: true }, { name: 'Name' }]]
];

for (const [label, columns] of sortCases) {
  test(`T-WB-16: view sort "${label}" returns the rows the generated step returns, ties in original order`, () => {
    const engine = viaEngine({ type: 'sort', columns });
    const view = viaView({ sort: columns.map((c) => ({ column: c.name, descending: !!c.descending })) });
    assert.equal(engine.ok, true, engine.message);
    assert.deepEqual(view, engine);
  });
}

test('T-WB-16: a filter and a sort together keep the filtered rows in sorted order', () => {
  const view = viaView({ filters: [{ column: 'Qty', op: 'gte', value: 7 }], sort: [{ column: 'Qty', descending: true }] });
  assert.deepEqual(view.rows.map((r) => r[0]), [1, 4, 3, 6]);
});

test('T-WB-16: hiding columns keeps the rest in order and refuses to hide them all', () => {
  const t = sourceTable();
  const some = applyView(t, { hidden: ['Name', 'Flag'] });
  assert.deepEqual(some.columns, [0, 2, 3]);
  assert.equal(some.rows.length, 6);
  const none = applyView(t, { hidden: t.columns.slice() });
  assert.equal(none.ok, false);
});

test('T-WB-16: an unknown column and an unknown filter are reported, not thrown', () => {
  const t = sourceTable();
  assert.equal(applyView(t, { filters: [{ column: 'Nope', op: 'equals', value: 1 }] }).ok, false);
  assert.equal(applyView(t, { filters: [{ column: 'Qty', op: 'near', value: 1 }] }).ok, false);
  assert.equal(applyView(t, { filters: [{ column: 'Qty', op: 'in', values: [] }] }).ok, false);
});

test('T-WB-16: literals for dates and date-times are checked', () => {
  assert.equal(viewValue({ date: '2024-03-05' }).k, 'date');
  assert.equal(viewValue({ datetime: '2024-03-05T10:30:00' }).k, 'datetime');
  assert.throws(() => viewValue({ date: '5 March' }));
  assert.equal(viewValue(null), null);
  assert.equal(viewValue(3), 3);
});

test('T-WB-16: an empty view is recognised', () => {
  assert.equal(isViewEmpty(null), true);
  assert.equal(isViewEmpty({ filters: [], sort: [], hidden: [] }), true);
  assert.equal(isViewEmpty({ hidden: ['A'] }), false);
});
