import test from 'node:test';
import assert from 'node:assert/strict';
import { indexSection } from '../../src/core/wb/deps.js';
import { sourcesOfSection } from '../../src/core/wb/sources.js';
import { problemsForQuery, problemsForModule, collectProblems, filterProblems, countProblems, lineCol } from '../../src/core/wb/problems.js';
import { quoteIdent } from '../../src/core/wb/ident.js';
import { supportedNames } from '../../src/core/wb/lib-names.js';

const section = (members) => `section Section1;\r\n\r\n${members.map(([n, e]) => `shared ${quoteIdent(n)} = ${e};`).join('\r\n\r\n')}`;
const ctxOf = (members, extra = {}) => {
  const text = section(members);
  return { sectionText: text, index: indexSection(text), sources: sourcesOfSection(text), libNames: supportedNames(), bound: new Set(), modules: [], ...extra };
};
const codes = (rows) => rows.map((r) => [r.code, r.severity, r.line, r.col]);

test('T-WB-18: a parse error carries its line and column inside the query', () => {
  const c = ctxOf([['Q', 'let\n  a = 1,\n  b = in\n in b']]);
  const rows = problemsForQuery('Q', c);
  assert.deepEqual(rows.map((r) => [r.code, r.severity, r.line]), [['m.parse', 'error', 3]]);
  assert.ok(rows[0].args.message);
});

test('T-WB-18: an unresolved identifier is an error at its position', () => {
  const c = ctxOf([['Q', 'let\n  a = Missing + 1\nin a']]);
  assert.deepEqual(codes(problemsForQuery('Q', c)), [['m.unresolved', 'error', 2, 7]]);
});

test('T-WB-18: a cycle is reported on each member with the whole cycle', () => {
  const c = ctxOf([['A', 'B'], ['B', 'A'], ['C', '1']]);
  assert.deepEqual(problemsForQuery('A', c).map((r) => [r.code, r.args.members]), [['m.cycle', ['A', 'B']]]);
  assert.deepEqual(problemsForQuery('B', c).map((r) => r.code), ['m.cycle']);
  assert.deepEqual(problemsForQuery('C', c), []);
});

test('T-WB-18: a library function the engine lacks is a warning, once per name', () => {
  const c = ctxOf([['Q', 'let s = Sql.Database("srv", "db"), t = Sql.Database("a", "b"), u = Table.SelectRows(#table({"x"}, {}), each true) in s']]);
  const rows = problemsForQuery('Q', c);
  assert.deepEqual(rows.filter((r) => r.code === 'm.unsupported').map((r) => [r.severity, r.args.name]), [['warning', 'Sql.Database']]);
});

test('T-WB-18: a literal file the user has not bound is an info row, a bound one is not', () => {
  const members = [['Q', 'Csv.Document(File.Contents("a.csv"))']];
  assert.deepEqual(problemsForQuery('Q', ctxOf(members)).map((r) => [r.code, r.severity, r.args.key]), [['m.external', 'info', 'a.csv']]);
  assert.deepEqual(problemsForQuery('Q', ctxOf(members, { bound: new Set(['a.csv']) })), []);
});

test('T-WB-18: a step that reads a later step is a warning naming both', () => {
  const rows = problemsForQuery('Q', ctxOf([['Q', 'let\n  A = B,\n  B = 1\nin A']]));
  assert.deepEqual(rows.map((r) => [r.code, r.severity, r.where, r.args.step, r.args.ref, r.line]), [['m.forwardRef', 'warning', 'A', 'A', 'B', 2]]);
});

test('T-WB-18: the last failed run is an error until it is cleared', () => {
  const c = ctxOf([['Q', '1']], { lastRun: new Map([['Q', { message: 'boom' }]]) });
  assert.deepEqual(problemsForQuery('Q', c).map((r) => [r.code, r.args.message]), [['m.lastRun', 'boom']]);
  assert.deepEqual(problemsForQuery('Q', ctxOf([['Q', '1']])), []);
});

test('T-WB-18: a clean query reports nothing', () => {
  assert.deepEqual(problemsForQuery('Q', ctxOf([['A', '1'], ['Q', 'let x = A in x']])), []);
});

test('T-WB-18: VBA structure, duplicate names, a wrong Exit and a missing Option Explicit', () => {
  const mod = { name: 'M1', kind: 'standard', text: ['Sub A()', '  If x Then', 'End Sub', 'Sub A()', '  Exit Function', 'End Sub'].join('\r\n') };
  const rows = problemsForModule(mod);
  assert.deepEqual(rows.map((r) => [r.code, r.severity, r.line, r.where]), [['vba.structure', 'error', 2, 'A'], ['vba.duplicate', 'error', 4, 'A'], ['vba.exit', 'warning', 5, 'A'], ['vba.noExplicit', 'info', 1, null]]);
  assert.deepEqual(problemsForModule({ name: 'E', kind: 'standard', text: '' }), []);
  assert.deepEqual(problemsForModule({ name: 'OK', kind: 'standard', text: 'Option Explicit\nSub A()\nEnd Sub' }), []);
});

test('T-WB-18: encoding problems from the validator are carried through with their position', () => {
  const mod = { name: 'M1', kind: 'standard', text: 'Option Explicit\nSub A()\n  s = "€"\nEnd Sub' };
  const rows = problemsForModule(mod, { validate: () => [{ code: 'vba.encoding', line: 3, col: 8, char: '€' }] });
  assert.deepEqual(rows.map((r) => [r.code, r.severity, r.line, r.col, r.where, r.args.char]), [['vba.encoding', 'error', 3, 8, 'A', '€']]);
});

test('T-WB-18: rows sort by severity, then by item order, then by position, and can be filtered and counted', () => {
  const c = ctxOf([['A', 'Csv.Document(File.Contents("a.csv"))'], ['B', 'Missing'], ['C', 'let a = b, b = 1 in a']], { modules: [{ name: 'M', kind: 'standard', text: 'Sub X()\nEnd Sub' }] });
  const rows = collectProblems(c);
  assert.deepEqual(rows.map((r) => [r.severity, r.item.name, r.code]), [['error', 'B', 'm.unresolved'], ['warning', 'C', 'm.forwardRef'], ['info', 'A', 'm.external'], ['info', 'M', 'vba.noExplicit']]);
  assert.deepEqual(countProblems(rows), { error: 1, warning: 1, info: 2 });
  assert.equal(filterProblems(rows, { severities: ['error', 'warning'] }).length, 2);
  assert.equal(filterProblems(rows, { itemType: 'module' }).length, 1);
});

test('T-WB-18: three hundred queries are checked in well under a second', () => {
  const members = [];
  for (let i = 0; i < 300; i++) members.push([`Q${i}`, i === 0 ? '1' : `let a = Q${i - 1}, b = Table.AddColumn(#table({"x"}, {{1}}), "y", each 1) in b`]);
  const c = ctxOf(members);
  const t0 = performance.now();
  const rows = collectProblems(c);
  assert.ok(performance.now() - t0 < 1000, `took ${performance.now() - t0} ms`);
  assert.deepEqual(rows, []);
});

test('T-WB-18: lineCol counts every kind of line ending', () => {
  assert.deepEqual(lineCol('a\r\nb\nc', 5), { line: 3, col: 1 });
  assert.deepEqual(lineCol('abc', 2), { line: 1, col: 3 });
});
