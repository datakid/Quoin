import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, completionAt } from '../../src/core/wb/completion.js';
import { M_NAMES } from '../../src/ui/wb/m-names.js';

const library = M_NAMES;
const columns = new Map([
  ['Source', ['CustomerID', 'Name', 'Amount']],
  ['Kept Rows', ['CustomerID', 'Amount']],
  ['S', ['Amount', 'Tax']]
]);
const queries = ['Other', 'Sales', 'Lookup'];
const ctx = { library, columns, queries, self: 'Lookup' };

const text = `let
    Source = Excel.CurrentWorkbook(){[Name="Table1"]}[Content],
    #"Kept Rows" = Table.SelectRows(Source, each [Amount] > 10),
    Added = Table.AddColumn(#"Kept Rows", "Double", each [Amount] * 2)
in
    Added`;
const at = (needle, from = 0) => text.indexOf(needle, from) + needle.length;
const labels = (r) => (r ? r.items.map((i) => `${i.kind}:${i.label}`) : []);
const first = (r, kind) => (r ? r.items.find((i) => i.kind === kind) : null);

test('T-WB-20b: inside a record bracket the columns of the input step come first', () => {
  const r = completionAt(text, at('each [Am'), ctx);
  assert.ok(r);
  assert.equal(r.mode, 'record');
  assert.equal(r.items[0].kind, 'column');
  assert.equal(r.items[0].label, 'Amount');
  assert.deepEqual(r.items.map((i) => i.kind).filter((k) => k === 'library'), []);
  const open = completionAt(text, at('"Double", each ['), ctx);
  assert.deepEqual(open.items.slice(0, 2).map((i) => i.label), ['CustomerID', 'Amount']);
  assert.equal(open.items.find((i) => i.kind === 'step').insert, 'Source');
});

test('T-WB-20b: each step sees the columns of its own input step', () => {
  const r = completionAt(text, text.lastIndexOf('each [Am') + 8, ctx);
  assert.ok(r);
  assert.deepEqual(r.items.filter((i) => i.kind === 'column').map((i) => i.label), ['Amount']);
});

test('T-WB-20b: steps in scope are offered with quoting, later steps and the current one are not', () => {
  const r = completionAt(text, at('"Double", '), ctx);
  const steps = r.items.filter((i) => i.kind === 'step').map((i) => i.label);
  assert.ok(steps.includes('Source'));
  assert.ok(steps.includes('Kept Rows'));
  assert.equal(first(r, 'step').items === undefined, true);
  assert.ok(!steps.includes('Added'));
  const quoted = first(r, 'step');
  const kept = r.items.find((i) => i.label === 'Kept Rows');
  assert.equal(kept.insert, '#"Kept Rows"');
  const body = completionAt(text, at('in\n    '), ctx);
  assert.deepEqual(body.items.filter((i) => i.kind === 'step').map((i) => i.label), ['Source', 'Kept Rows', 'Added']);
});

test('T-WB-20b: a nested let sees the outer steps but not its siblings later names', () => {
  const nested = 'let a = (let inner = 1 in inner), b = ';
  const inside = completionAt(nested, nested.indexOf('inner = ') + 8, ctx);
  const names = inside.items.filter((i) => i.kind === 'step').map((i) => i.label);
  assert.ok(names.includes('a'));
  assert.ok(!names.includes('inner'));
  assert.ok(!names.includes('b'));
  const after = completionAt(nested, nested.length, ctx);
  assert.deepEqual(after.items.filter((i) => i.kind === 'step').map((i) => i.label), ['a']);
});

test('T-WB-20b: the body of in keeps every step in scope', () => {
  const body = 'let A = 1 in [Total = A';
  const r = completionAt(body, body.length, ctx);
  assert.ok(r);
  assert.equal(r.items[0].label, 'A');
  assert.equal(r.mode, 'record');
});

test('T-WB-20b: query names are offered, the current query is not, a step shadows a query', () => {
  const r = completionAt(text, at('"Double", '), ctx);
  const names = r.items.filter((i) => i.kind === 'query').map((i) => i.label);
  assert.ok(names.includes('Other'));
  assert.ok(names.includes('Sales'));
  const shadow = completionAt('let Sales = 1, B = Sal', 22, { ...ctx, queries: ['Sales', 'Salaries'] });
  assert.deepEqual(shadow.items.filter((i) => i.kind === 'query').map((i) => i.label), ['Salaries']);
  const self = completionAt('Oth', 3, { ...ctx, queries: ['Other', 'Sales'] });
  assert.deepEqual(self.items.filter((i) => i.kind === 'query').map((i) => i.label), ['Other']);
});

test('T-WB-20b: the contextual keywords are offered and never inside a record bracket', () => {
  const r = completionAt(text, at('"Double", '), ctx);
  assert.ok(['each', 'let', 'in', 'if'].every((k) => r.items.some((i) => i.kind === 'keyword' && i.label === k)));
  const inBrackets = completionAt(text, at('"Double", each ['), ctx);
  assert.deepEqual(inBrackets.items.filter((i) => i.kind === 'keyword'), []);
});

test('T-WB-20b: after a dot in a library prefix the category members complete by their tail', () => {
  const r = completionAt('let x = Text.U in x', 14, ctx);
  assert.ok(r);
  assert.equal(r.mode, 'library');
  assert.equal(r.auto, true);
  assert.ok(r.items.some((i) => i.label === 'Text.Upper' && i.insert === 'Upper'));
  const lower = completionAt('let x = text.u in x', 14, ctx);
  assert.ok(lower.items.some((i) => i.label === 'Text.Upper'));
  const detail = r.items.find((i) => i.label === 'Text.Upper');
  assert.equal(detail.detail, '(text, culture?)');
  assert.equal(detail.status, 'full');
  const unsupported = completionAt('let x = OData.F in x', 15, ctx);
  assert.equal(unsupported.items[0].status, 'unsupported');
});

test('T-WB-20b: library names without a dot are fuzzy-ranked over the full name', () => {
  const r = completionAt('let x = Tab in x', 11, ctx);
  assert.equal(r.auto, true);
  assert.ok(r.items.every((i) => i.kind === 'library'));
  assert.ok(r.items.some((i) => i.label === 'Table.Buffer'));
  const fuzzy = completionAt('let x = tbl in x', 11, ctx);
  assert.ok(fuzzy.items.some((i) => i.label === 'Table.Buffer'));
  assert.equal(fuzzy.auto, true);
});

test('T-WB-20b: a quoted identifier in progress offers steps and queries and inserts closed quotes', () => {
  const r = completionAt('let a = 1, #"Kept Rows" = a, b = #"Ke', 37, ctx);
  assert.ok(r);
  assert.equal(r.mode, 'quoted');
  const item = r.items.find((i) => i.label === 'Kept Rows');
  assert.ok(item);
  assert.equal(item.insert, '#"Kept Rows"');
  assert.ok(r.items.some((i) => i.kind === 'step' && i.label === 'Kept Rows' && i.insert === '#"Kept Rows"'));
  const query = completionAt('let a = 1, #"Kept Rows" = a, b = #"O', 36, ctx);
  assert.ok(query.items.some((i) => i.kind === 'query' && i.label === 'Other' && i.insert === '#"Other"'));
  const none = completionAt('let a = 1, b = #"Zzz', 20, ctx);
  assert.equal(none, null);
});

test('T-WB-20b: hash literals complete from the lexer keywords', () => {
  const r = completionAt('let x = #da', 11, ctx);
  assert.deepEqual(r.items.map((i) => i.label), ['#date', '#datetime', '#datetimezone']);
  assert.equal(r.mode, 'literal');
  const all = completionAt('let x = #', 9, ctx);
  assert.ok(all.items.length > 5);
  assert.ok(all.items.every((i) => i.label[0] === '#'));
  assert.equal(completionAt('let x = a#d', 11, ctx), null);
});

test('T-WB-20b: nothing is offered inside strings and comments, after numbers, or in a binding name', () => {
  assert.equal(completionAt('let a = "Dou', 12, ctx), null);
  assert.equal(completionAt('let a = 1 // hel', 16, ctx), null);
  assert.equal(completionAt('let a = 1 /* hel', 16, ctx), null);
  assert.equal(completionAt('let a = 12.', 11, ctx), null);
  assert.equal(completionAt('let a = 1e', 10, ctx), null);
  assert.equal(completionAt('let aa = 1 in aa', 6, ctx), null);
});

test('T-WB-20b: the replace range covers the whole word, including the part after the caret', () => {
  const r = completionAt('Tab' + 'le', 3, ctx);
  assert.deepEqual([r.start, r.end], [0, 5]);
  assert.equal(r.items.some((i) => i.label === 'Table.Buffer' && i.insert === 'Table.Buffer'), true);
});

test('T-WB-20b: field access after a step name offers that step columns, unknown heads offer nothing', () => {
  const r = completionAt('let S = 1, A = S[Am', 19, ctx);
  assert.ok(r);
  assert.deepEqual(r.items.map((i) => i.label), ['Amount']);
  const unknown = completionAt('let S = 1, A = foo()[Am', 23, ctx);
  assert.equal(unknown, null);
});

test('T-WB-20b: a prefix match on a query beats an equally scored keyword, and tiers hold otherwise', () => {
  const r = completionAt('{"x"}, O', 8, { ...ctx, self: 'Lookup' });
  assert.ok(r.items.findIndex((i) => i.label === 'Other') < r.items.findIndex((i) => i.label === 'otherwise'));
  const fresh = completionAt(text, at('"Double", '), ctx);
  const kinds = fresh.items.map((i) => i.kind);
  assert.ok(kinds.indexOf('step') < kinds.indexOf('query'));
  assert.ok(kinds.indexOf('query') < kinds.indexOf('keyword'));
});

test('T-WB-20b: the list is capped and the auto flag follows the plan rules', () => {
  const fresh = completionAt(text, at('"Double", '), ctx);
  assert.ok(fresh.items.length <= 60);
  assert.equal(fresh.auto, false);
  const one = completionAt('O', 1, ctx);
  assert.equal(one.auto, false);
  const two = completionAt('Oth', 3, ctx);
  assert.equal(two.auto, true);
  assert.equal(two.items[0].label, 'Other');
});

test('T-WB-20b: CRLF text, unicode names and function bodies work', () => {
  const crlf = 'let\r\n  S = 1,\r\n  A = Table.AddColumn(S, "x", each [Am';
  const r = completionAt(crlf, crlf.length, { ...ctx, columns: new Map([['S', ['Amount', 'Tax']]]) });
  assert.equal(r.items[0].label, 'Amount');
  const uni = completionAt('let Äpfel = 1, B = Äp', 21, ctx);
  assert.equal(uni.items[0].label, 'Äpfel');
  const fn = completionAt('(x) => Tab', 10, ctx);
  assert.equal(fn.items[0].kind, 'library');
});

test('T-WB-20b: analyze reports binding spans a parser could not give on half-typed text', () => {
  const partial = 'let Source = 1, Kept = Table.SelectRows(Source, each [Am';
  const { bindings } = analyze(partial, partial.length);
  assert.deepEqual(bindings.map((b) => b.name), ['Source', 'Kept']);
  assert.equal(bindings[0].exprEnd, partial.indexOf(', Kept'));
  assert.equal(bindings[1].exprEnd, partial.length);
  assert.equal(bindings[1].limit, partial.length);
  const closed = analyze('let a = 1, b = a in b', 21);
  assert.equal(closed.bindings[1].exprEnd, closed.bindings[1].limit);
  assert.ok(closed.bindings[0].exprEnd < closed.bindings[1].start);
});
