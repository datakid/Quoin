import test from 'node:test';
import assert from 'node:assert/strict';
import { completionContext, completionItems, shouldAutoComplete, stepsInScope, signatureAt, signatureText, definitionAt, referencesIn, parseParams } from '../../src/core/wb/editor-intel.js';
import { stepsOf } from '../../src/core/wb/steps.js';
import { M_NAMES } from '../../src/ui/wb/m-names.js';

const SAMPLE = [
  'let',
  '    Source = #table({"A", "B"}, {{1, "x"}}),',
  '    Filtered = Table.SelectRows(Source, each [A] > 0),',
  '    #"Sorted Rows" = Table.Sort(Filtered, {{"A", Order.Descending}})',
  'in',
  '    #"Sorted Rows"'
].join('\n');

const model = stepsOf(SAMPLE, 0);
const names = new Map(M_NAMES.map((r) => [r[0], r]));
const at = (needle, nth = 0) => {
  let i = -1;
  for (let k = 0; k <= nth; k++) i = SAMPLE.indexOf(needle, i + 1);
  return i;
};

test('T-WB-20: a typed prefix, a trailing dot, a quoted name and an empty spot each give their own context', () => {
  assert.deepEqual(completionContext('Table.Sel', 9), { kind: 'name', start: 0, end: 9, prefix: 'Table.Sel' });
  assert.equal(completionContext('Table.', 6).prefix, 'Table.');
  assert.equal(completionContext('Table.', 6).start, 0);
  assert.equal(completionContext('x = #"Fil', 9).prefix, 'Fil');
  assert.equal(completionContext('x = ', 4).prefix, '');
  assert.equal(completionContext('x = 1 + ', 8).kind, 'name');
});

test('T-WB-20: nothing is offered inside a string or a comment', () => {
  assert.equal(completionContext('"abc def"', 4), null);
  assert.equal(completionContext('"abc', 4), null);
  assert.equal(completionContext('// note Tab', 11), null);
  assert.notEqual(completionContext('"abc" & Tab', 11), null);
  assert.notEqual(completionContext('// note\nTab', 11), null);
});

test('T-WB-20: after an opening bracket the context is a column, with what was typed so far', () => {
  const ctx = completionContext('each [Na', 8);
  assert.deepEqual([ctx.kind, ctx.prefix, ctx.start], ['column', 'Na', 6]);
  assert.equal(completionContext('Source[', 7).kind, 'column');
  assert.equal(completionContext('each [#"First N', 15).prefix, 'First N');
  assert.equal(completionContext('each [A] > Ta', 13).kind, 'name');
});

test('T-WB-20: automatic completion needs two characters, a dot, or a column bracket', () => {
  assert.equal(shouldAutoComplete(completionContext('T', 1)), false);
  assert.equal(shouldAutoComplete(completionContext('Ta', 2)), true);
  assert.equal(shouldAutoComplete(completionContext('Table.', 6)), true);
  assert.equal(shouldAutoComplete(completionContext('each [', 6)), true);
  assert.equal(shouldAutoComplete(completionContext('x = ', 4)), false);
  assert.equal(shouldAutoComplete(null), false);
});

test('T-WB-20: only the steps before the caret are in scope', () => {
  assert.deepEqual(stepsInScope(model.steps, at('Source, each')).map((s) => s.name), ['Source']);
  assert.deepEqual(stepsInScope(model.steps, at('Filtered, {{')).map((s) => s.name), ['Source', 'Filtered']);
  assert.deepEqual(stepsInScope(model.steps, SAMPLE.length).map((s) => s.name), ['Source', 'Filtered', 'Sorted Rows']);
  assert.deepEqual(stepsInScope(model.steps, at('Filtered =')).map((s) => s.name), ['Source']);
});

test('T-WB-20: library names complete with the exact function first, and constants have no parameters', () => {
  const ctx = completionContext('Table.SelectR', 13);
  const items = completionItems(ctx, { names: M_NAMES, steps: [], members: [] });
  assert.equal(items[0].label, 'Table.SelectRows');
  assert.equal(items[0].kind, 'function');
  assert.equal(items[0].params, 'table,condition');
  const consts = completionItems(completionContext('Order.Des', 9), { names: M_NAMES, steps: [], members: [] });
  assert.equal(consts[0].label, 'Order.Descending');
  assert.equal(consts[0].kind, 'constant');
});

test('T-WB-20: steps and queries are offered, a step hides a query of the same name, and the current query is left out', () => {
  const env = { names: M_NAMES, steps: model.steps.slice(0, 2), members: ['Filtered', 'Sales', 'Current'], current: 'Current' };
  const items = completionItems(completionContext('Fil', 3), env);
  const labels = items.map((i) => i.label);
  assert.equal(items[0].label, 'Filtered');
  assert.equal(items[0].kind, 'step');
  assert.equal(labels.filter((l) => l === 'Filtered').length, 1);
  const all = completionItems(completionContext('', 0), env);
  assert.ok(all.some((i) => i.label === 'Sales' && i.kind === 'query'));
  assert.ok(!all.some((i) => i.label === 'Current'));
  assert.ok(completionItems(completionContext('eac', 3), env).some((i) => i.label === 'each' && i.kind === 'keyword'));
});

test('T-WB-20: a step name that needs quoting is inserted quoted', () => {
  const env = { names: [], steps: model.steps, members: [] };
  const item = completionItems(completionContext('Sor', 3), env)[0];
  assert.equal(item.label, 'Sorted Rows');
  assert.equal(item.insert, '#"Sorted Rows"');
});

test('T-WB-20: column names complete inside brackets and are quoted when they need it', () => {
  const env = { columns: ['City', 'First Name', 'Age'] };
  const ctx = completionContext('each [Ci', 8);
  const items = completionItems(ctx, env);
  assert.equal(items[0].label, 'City');
  assert.equal(items[0].insert, 'City');
  assert.equal(completionItems(completionContext('each [Fir', 9), env)[0].insert, '#"First Name"');
  assert.deepEqual(completionItems(completionContext('each [', 6), env).map((i) => i.label), ['City', 'First Name', 'Age']);
  assert.deepEqual(completionItems(completionContext('each [', 6), {}), []);
});

test('T-WB-20: at most fifty items come back', () => {
  assert.equal(completionItems(completionContext('', 0), { names: M_NAMES, steps: [], members: [] }).length, 50);
});

test('T-WB-20: signature help finds the call around the caret and the parameter being typed', () => {
  const t = 'Table.SelectRows(Source, ';
  const s = signatureAt(t, t.length, names);
  assert.equal(s.name, 'Table.SelectRows');
  assert.equal(s.active, 1);
  assert.equal(signatureText(s), 'Table.SelectRows(table, condition)');
  assert.equal(signatureAt('Table.SelectRows(', 17, names).active, 0);
  assert.equal(signatureAt('Table.AddColumn(T, "x", ', 24, names).active, 2);
  assert.equal(signatureText(signatureAt('Table.AddColumn(', 16, names)), 'Table.AddColumn(table, newColumnName, columnGenerator, [columnType])');
});

test('T-WB-20: commas inside nested brackets and inner calls do not move the parameter, and an inner call wins', () => {
  const t = 'Table.Sort(Filtered, {{"A", Order.Descending}, ';
  assert.equal(signatureAt(t, t.length, names).active, 1);
  const inner = 'Table.SelectRows(Source, each Text.Contains([A], ';
  const s = signatureAt(inner, inner.length, names);
  assert.equal(s.name, 'Text.Contains');
  assert.equal(s.active, 1);
});

test('T-WB-20: there is no signature outside a call, after it is closed, or for an unknown name', () => {
  assert.equal(signatureAt('Table.SelectRows(Source, each true)', 35, names), null);
  assert.equal(signatureAt('Source', 6, names), null);
  assert.equal(signatureAt('Mine.Thing(', 11, names), null);
  assert.equal(signatureAt('(1 + ', 5, names), null);
});

test('T-WB-20: an argument beyond the last parameter stays on the last one and says so', () => {
  const t = 'Text.Contains(a, b, c, d, ';
  const s = signatureAt(t, t.length, names);
  assert.equal(s.active, 2);
  assert.equal(s.over, true);
});

test('T-WB-20: parseParams reads the generated parameter list', () => {
  assert.deepEqual(parseParams('table,?columnType'), [{ name: 'table', optional: false }, { name: 'columnType', optional: true }]);
  assert.deepEqual(parseParams(''), []);
  assert.equal(parseParams(null), null);
});

test('T-WB-20: go to definition resolves a step, then a query, then a library name, and nothing for the rest', () => {
  const env = { steps: model.steps, members: ['Sales', 'Filtered'], names, current: 'Q' };
  const useOfFiltered = at('Filtered, {{');
  const d = definitionAt(SAMPLE, useOfFiltered + 2, env);
  assert.equal(d.kind, 'step');
  assert.equal(d.offset, at('Filtered ='));
  assert.equal(d.here, false);
  assert.equal(definitionAt(SAMPLE, at('Filtered =') + 1, env).here, true);
  assert.deepEqual(definitionAt('Sales', 2, { ...env, steps: [] }), { kind: 'query', name: 'Sales' });
  const f = definitionAt(SAMPLE, at('Table.SelectRows') + 3, env);
  assert.equal(f.kind, 'function');
  assert.equal(signatureText({ name: f.name, params: f.params }), 'Table.SelectRows(table, condition)');
  assert.equal(definitionAt(SAMPLE, at('Order.Descending') + 2, env).kind, 'constant');
  assert.equal(definitionAt(SAMPLE, at('"A"') + 1, env), null);
  assert.equal(definitionAt('Unknown', 3, env), null);
});

test('T-WB-20: a step wins over a query of the same name, and the current query is not a target', () => {
  const env = { steps: model.steps, members: ['Filtered', 'Q'], names, current: 'Q' };
  assert.equal(definitionAt(SAMPLE, at('Filtered, {{') + 1, env).kind, 'step');
  assert.equal(definitionAt('Q', 0, { steps: [], members: ['Q'], names, current: 'Q' }), null);
});

test('T-WB-20: references are token exact, with quoted names, and skip strings, comments and the definition', () => {
  const text = 'let\n    A = 1,\n    B = A + A, // A here\n    C = "A" & Text.From(A)\nin\n    C';
  const docs = [{ name: 'Q', text }];
  const defStart = text.indexOf('A =');
  const refs = referencesIn('A', docs, { skipDefinition: { query: 'Q', start: defStart } });
  assert.equal(refs.length, 3);
  assert.deepEqual(refs.map((r) => r.line), [3, 3, 4]);
  assert.equal(refs[0].text, 'B = A + A, // A here');
  assert.equal(referencesIn('A', docs).length, 4);
  const quoted = referencesIn('Sorted Rows', [{ name: 'Q', text: SAMPLE }], { skipDefinition: { query: 'Q', start: at('#"Sorted Rows" =') } });
  assert.equal(quoted.length, 1);
  assert.equal(quoted[0].line, 6);
});

test('T-WB-20: query references are counted across every query', () => {
  const docs = [
    { name: 'One', text: 'let\n    S = Sales,\n    T = Table.Combine({S, Sales})\nin\n    T' },
    { name: 'Two', text: 'Sales' },
    { name: 'Three', text: '"Sales"' }
  ];
  const refs = referencesIn('Sales', docs);
  assert.deepEqual(refs.map((r) => [r.query, r.line]), [['One', 2], ['One', 3], ['Two', 1]]);
});
