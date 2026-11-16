import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRegex, searchAll, searchText, applyReplacements, expandReplacement, previewReplacement, findInItems, codeMask, MAX_MATCHES } from '../../src/core/wb/find.js';

const find = (text, query, o = {}) => searchAll(text, { query, ...o }).matches;
const spans = (ms) => ms.map((m) => [m.start, m.end]);

test('T-WB-21: plain search is case-insensitive by default and exact with match case', () => {
  assert.deepEqual(spans(find('Sales sales SALES', 'sales')), [[0, 5], [6, 11], [12, 17]]);
  assert.deepEqual(spans(find('Sales sales SALES', 'sales', { matchCase: true })), [[6, 11]]);
});

test('T-WB-21: regex metacharacters in a plain query are literal', () => {
  assert.deepEqual(spans(find('a.b a+b axb', 'a.b')), [[0, 3]]);
  assert.deepEqual(spans(find('f(x) g(x)', '(x)')), [[1, 4], [6, 9]]);
});

test('T-WB-21: whole word respects letters, digits and underscore, including non-ASCII', () => {
  assert.deepEqual(spans(find('Sales Sales_Raw Sales2 XSales Sales', 'Sales', { wholeWord: true })), [[0, 5], [30, 35]]);
  assert.deepEqual(spans(find('café cafés', 'café', { wholeWord: true })), [[0, 4]]);
});

test('T-WB-21: a regular expression with groups, and an invalid one reports its error', () => {
  const ms = find('a1 b22 c333', '([a-z])(\\d+)', { regex: true });
  assert.deepEqual(ms.map((m) => m.groups), [['a', '1'], ['b', '22'], ['c', '333']]);
  const bad = searchAll('x', { query: '(', regex: true });
  assert.ok(bad.error);
  assert.deepEqual(bad.matches, []);
  assert.deepEqual(buildRegex('', {}), { error: null, re: null });
});

test('T-WB-21: matches carry line, column and the line text for a preview, across line endings', () => {
  const ms = find('one\r\ntwo sales\nthree\rsales again', 'sales');
  assert.deepEqual(ms.map((m) => [m.line, m.col, m.preview]), [[2, 5, 'two sales'], [4, 1, 'sales again']]);
});

test('T-WB-21: code only skips comments and string literals in M', () => {
  const t = 'let\n  // Sales is a comment\n  a = "Sales text",\n  b = Sales /* Sales */ + 1\nin b';
  assert.equal(find(t, 'Sales').length, 4);
  const code = find(t, 'Sales', { codeOnly: true, language: 'm' });
  assert.deepEqual(code.map((m) => m.line), [4]);
});

test('T-WB-21: code only skips VBA comments, Rem lines and strings with doubled quotes', () => {
  const t = ["Sub Sales()", "  s = \"say \"\"Sales\"\" now\"", "  ' Sales here", "  Rem Sales there", "  x = Sales + 1 ' Sales tail", "End Sub"].join('\n');
  const code = find(t, 'Sales', { codeOnly: true, language: 'vba' });
  assert.deepEqual(code.map((m) => m.line), [1, 5]);
  assert.equal(find(t, 'Sales').length, 6);
});

test('T-WB-21: a match that straddles a string boundary is not code', () => {
  const t = 'a = "x" & y';
  assert.deepEqual(find(t, '"x" & y', { codeOnly: true, language: 'm' }), []);
});

test('T-WB-21: the code mask marks only non-comment non-string characters', () => {
  const mask = codeMask('a "b" // c\nd', 'm');
  assert.deepEqual([...mask], [1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1].slice(0, 12).map((x, i) => mask[i]));
  assert.equal(mask[3], 0);
  assert.equal(mask[0], 1);
  assert.equal(mask[11], 1);
});

test('T-WB-21: zero-length regex matches are ignored and the cap stops a runaway search', () => {
  assert.deepEqual(find('abc', 'x*', { regex: true }), []);
  const big = 'a'.repeat(MAX_MATCHES + 50);
  const r = searchAll(big, { query: 'a' });
  assert.equal(r.matches.length, MAX_MATCHES);
  assert.equal(r.capped, true);
});

test('T-WB-21: a long search yields between chunks when the budget is spent', () => {
  let t = 0;
  const steps = [...searchText('a '.repeat(5000), { query: 'a' }, { budgetMs: 10, now: () => (t += 1) })];
  assert.ok(steps.length > 3);
  assert.equal(steps[steps.length - 1].done, true);
  assert.equal(steps[steps.length - 1].matches.length, 5000);
  assert.ok(steps.slice(0, -1).every((s) => s.done === false));
});

test('T-WB-21: replace applies chosen matches only, from the end, and expands groups', () => {
  const text = 'Sales Sales Sales Sales Sales';
  const ms = find(text, 'Sales');
  assert.equal(applyReplacements(text, [ms[0], ms[2], ms[4]], 'Rev'), 'Rev Sales Rev Sales Rev');
  const g = find('k1=v1 k2=v2', '(\\w+)=(\\w+)', { regex: true });
  assert.equal(applyReplacements('k1=v1 k2=v2', g, '$2:$1 [$&] $$', { regex: true }), 'v1:k1 [k1=v1] $ v2:k2 [k2=v2] $');
  assert.equal(expandReplacement('$3', { text: 'x', groups: ['a'] }, true), '$3');
  assert.equal(expandReplacement('$1', { text: 'x', groups: ['a'] }, false), '$1');
});

test('T-WB-21: a replacement preview shows the line before and after', () => {
  const [m] = find('let a = Sales + 1', 'Sales');
  assert.deepEqual(previewReplacement(m, 'Revenue'), { before: 'let a = Sales + 1', after: 'let a = Revenue + 1' });
});

test('T-WB-21: scopes restrict the items searched, read-only items are listed with their reason', () => {
  const items = [
    { type: 'query', name: 'Q1', text: 'Sales', readOnly: null, current: true },
    { type: 'query', name: 'Q2', text: 'Sales Sales', readOnly: 'The mashup cannot be parsed.', selected: true },
    { type: 'module', name: 'M1', text: 'Sub Sales()', readOnly: 'This macro project is locked.' },
    { type: 'module', name: 'M2', text: 'none' }
  ];
  const all = findInItems(items, { query: 'sales' });
  assert.deepEqual(all.results.map((r) => [r.item.name, r.matches.length, r.skipped]), [['Q1', 1, null], ['Q2', 2, 'The mashup cannot be parsed.'], ['M1', 1, 'This macro project is locked.']]);
  assert.equal(all.total, 4);
  assert.deepEqual(findInItems(items, { query: 'sales', scope: 'queries' }).results.map((r) => r.item.name), ['Q1', 'Q2']);
  assert.deepEqual(findInItems(items, { query: 'sales', scope: 'modules' }).results.map((r) => r.item.name), ['M1']);
  assert.deepEqual(findInItems(items, { query: 'sales', scope: 'current' }).results.map((r) => r.item.name), ['Q1']);
  assert.deepEqual(findInItems(items, { query: 'sales', scope: 'selection' }).results.map((r) => r.item.name), ['Q2']);
});

test('T-WB-21: an invalid regular expression stops the whole search with its message', () => {
  const r = findInItems([{ type: 'query', name: 'Q', text: 'x' }], { query: '[', regex: true });
  assert.ok(r.error);
  assert.deepEqual(r.results, []);
});

test('T-WB-21: code only uses the macro scanner for modules and the lexer for queries', () => {
  const items = [{ type: 'query', name: 'Q', text: '// Sales\nSales' }, { type: 'module', name: 'M', text: "' Sales\nSales = 1" }];
  const r = findInItems(items, { query: 'Sales', codeOnly: true });
  assert.deepEqual(r.results.map((x) => [x.item.name, x.matches.map((m) => m.line)]), [['Q', [2]], ['M', [2]]]);
});

test('T-WB-21: the asynchronous search gives the same results, yields between items and can be cancelled', async () => {
  const { findInItemsAsync } = await import('../../src/core/wb/find.js');
  const items = [{ type: 'query', name: 'A', text: 'Sales' }, { type: 'query', name: 'B', text: 'none' }, { type: 'module', name: 'M', text: 'Sales Sales' }];
  let yields = 0;
  const r = await findInItemsAsync(items, { query: 'sales' }, { yieldFn: async () => { yields++; } });
  assert.deepEqual(r.results.map((x) => [x.item.name, x.matches.length]), [['A', 1], ['M', 2]]);
  assert.ok(yields >= 2);
  let calls = 0;
  const c = await findInItemsAsync(items, { query: 'sales' }, { isCancelled: () => ++calls > 2 });
  assert.equal(c.cancelled, true);
  const bad = await findInItemsAsync(items, { query: '[', regex: true });
  assert.ok(bad.error);
});
