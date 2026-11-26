import test from 'node:test';
import assert from 'node:assert/strict';
import { nameAt, referencesOf, resolveNameAt, signatureAt } from '../../src/core/wb/m-refs.js';
import { M_NAMES } from '../../src/ui/wb/m-names.js';

const library = M_NAMES;
const ctx = { library, queries: ['Sales', 'Lookup'] };

const text = `let
    Source = Excel.CurrentWorkbook(){[Name="T1"]}[Content],
    #"Kept Rows" = Table.SelectRows(Source, each [Amount] > 10),
    Added = Table.AddColumn(#"Kept Rows", "Note", each Text.Upper([Note]))
in
    Added`;
const at = (needle) => text.indexOf(needle) + needle.length;
const other = 'let\n    Base = Sales,\n    More = Table.Transform(Base, {{"A", type text}})\nin\n    More';

test('T-WB-20c: the name under the caret is found token-accurately, dotted and quoted', () => {
  const a = nameAt(text, at('Text.Upper'));
  assert.deepEqual([a.name, a.start, a.end], ['Text.Upper', at('Text.Upper') - 10, at('Text.Upper')]);
  const q = nameAt(text, at('"Kept Rows"') - 2);
  assert.equal(q.name, 'Kept Rows');
  assert.equal(nameAt('let a = "Up', 12), null);
  assert.equal(nameAt('let a = 1 // Up', 15), null);
});

test('T-WB-20c: references list every token occurrence across queries, with the definition tagged', () => {
  const rows = referencesOf([{ name: 'Main', text }, { name: 'Other', text: other }], 'Kept Rows');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => [r.item, r.kind]), [['Main', 'definition'], ['Main', 'reference']]);
  assert.equal(rows[0].line, 3);
  assert.equal(rows[0].col, 5);
  assert.equal(rows[1].col, 29);
  const whole = referencesOf([{ name: 'Main', text }, { name: 'Other', text: other }], 'Source');
  assert.equal(whole.filter((r) => r.item === 'Main').length, 2);
  assert.equal(whole.some((r) => r.kind === 'definition'), true);
});

test('T-WB-20c: references are case-insensitive and skip string literals and comments', () => {
  const t = 'let a = 1, b = SALE, c = "sale", d = sale // sale\nin b';
  const rows = referencesOf([{ name: 'Q', text: t }], 'Sale');
  assert.deepEqual(rows.map((r) => [r.kind, r.excerpt]), [['reference', 'let a = 1, b = SALE, c = "sale", d = sale // sale'], ['reference', 'let a = 1, b = SALE, c = "sale", d = sale // sale']]);
  const t2 = 'let SALE = 1, b = sale in sale';
  assert.equal(referencesOf([{ name: 'Q', text: t2 }], 'Sale').length, 3);
});

test('T-WB-20c: the name resolves to a step, a query, a library function or nothing', () => {
  const step = resolveNameAt(text, at('Table.SelectRows(Source'), ctx);
  assert.equal(step.kind, 'step');
  assert.equal(step.binding.topLevel, true);
  assert.equal(step.binding.index, 0);
  const self = resolveNameAt(text, at('    #"Kept Rows" =') - 2, ctx);
  assert.equal(self.kind, 'step');
  const nestedText = 'let a = (let inner = 1 in inner), b = inner in b';
  const nested = resolveNameAt(nestedText, nestedText.indexOf('inner') + 5, ctx);
  assert.equal(nested.kind, 'step');
  assert.equal(nested.binding.topLevel, false);
  const query = resolveNameAt('let a = Sales in a', at('let a = Sales'), ctx);
  assert.equal(query.kind, 'query');
  const lib = resolveNameAt(text, at('Text.Upper') - 1, ctx);
  assert.equal(lib.kind, 'library');
  assert.equal(lib.library.name, 'Text.Upper');
  const none = resolveNameAt('let a = Mystery in a', at('let a = Mystery'), ctx);
  assert.equal(none.kind, 'unknown');
});

test('T-WB-20c: a shadowing step wins over the query of the same name', () => {
  const shadow = resolveNameAt('let Sales = 1, B = Sales in B', 'let Sales = 1, B = Sales in B'.indexOf('B = Sales') + 9, ctx);
  assert.equal(shadow.kind, 'step');
  const inBody = resolveNameAt('let Sales = 1 in Sales + 1', 'let Sales = 1 in Sales'.length, ctx);
  assert.equal(inBody.kind, 'step');
});

test('T-WB-20c: signature help finds the innermost call and the current parameter', () => {
  const sig = signatureAt(text, at('Text.Upper([Note])') - 1, library);
  assert.equal(sig.name, 'Text.Upper');
  assert.equal(sig.current, 0);
  const nested = 'let x = Table.Combine({List.First({1}), List.Last({2})}) in x';
  const inner = signatureAt(nested, nested.indexOf('List.Last({2})') + 13, library);
  assert.equal(inner.name, 'List.Last');
  assert.equal(inner.current, 0);
  const outer = signatureAt(nested, nested.length - 6, library);
  assert.equal(outer.name, 'Table.Combine');
  assert.equal(outer.current, 1);
  const second = signatureAt('let x = Table.ReplaceValue(T, "a", "b", Replacer.ReplaceText) in x', 58, library);
  assert.equal(second.current, 3);
  const optional = signatureAt('let x = Text.PadStart(T, 3, "0") in x', 30, library);
  assert.equal(optional.name, 'Text.PadStart');
  assert.equal(optional.entry.optional.length, 1);
});

test('T-WB-20c: signature help is null outside a call and for non-function callees', () => {
  assert.equal(signatureAt(text, at('in'), library), null);
  assert.equal(signatureAt('let x = RoundingMode.Down in x', 20, library), null);
  assert.equal(signatureAt('let x = each (1) in x', 16, library), null);
});
