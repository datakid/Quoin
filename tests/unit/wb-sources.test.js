import test from 'node:test';
import assert from 'node:assert/strict';
import { findSources, sourcesOfSection, bindingKeysOf, unbound } from '../../src/core/wb/sources.js';
import { parseExpressionText } from '../../src/core/m/parser.js';
import { runOnce } from '../../src/core/m/engine.js';
import { baseOptions } from './helpers.js';

const section = (members) => `section Section1;\r\n\r\n${members.map(([n, e]) => `shared ${n} = ${e};`).join('\r\n\r\n')}`;
const found = (text) => findSources(parseExpressionText(text, 0));

test('T-WB-19: File.Contents under Excel.Workbook and Csv.Document yields a bindable file source with its literal key', () => {
  assert.deepEqual(found('Excel.Workbook(File.Contents("c:\\data\\a.xlsx"), true)').map((s) => [s.kind, s.call, s.key, s.bindable, s.dynamic]), [['file', 'File.Contents', 'c:\\data\\a.xlsx', true, false]]);
  assert.deepEqual(found('Csv.Document(File.Contents("b.csv"), [Delimiter=","])').map((s) => s.key), ['b.csv']);
});

test('T-WB-19: a web source and its options', () => {
  assert.deepEqual(found('Json.Document(Web.Contents("https://example.com/x.json", [Headers = [a = "b"]]))').map((s) => [s.kind, s.key]), [['web', 'https://example.com/x.json']]);
});

test('T-WB-19: a computed argument is dynamic and has no key', () => {
  const s = found('File.Contents(base & "\\x.csv")');
  assert.deepEqual([s[0].dynamic, s[0].key, s[0].bindable], [true, null, true]);
  assert.equal(found('File.Contents(path)')[0].dynamic, true);
});

test('T-WB-19: folders and databases are listed but cannot be bound', () => {
  const s = found('{Folder.Files("c:\\in"), Sql.Database("srv", "db"), SharePoint.Files("https://x.sharepoint.com")}');
  assert.deepEqual(s.map((x) => [x.kind, x.bindable]), [['folder', false], ['database', false], ['sharepoint', false]]);
});

test('T-WB-19: several sources in one query and sources inside a function body are found', () => {
  assert.equal(found('{File.Contents("a"), File.Contents("b")}').length, 2);
  assert.equal(found('(p) => let s = File.Contents("a") in s').length, 1);
});

test('T-WB-19: text and comments that mention a connector are not sources', () => {
  assert.deepEqual(found('"File.Contents(""x"")" & Text.From(1) // File.Contents("y")'), []);
});

test('T-WB-19: the inventory merges equal sources across queries and lists who uses each', () => {
  const inv = sourcesOfSection(section([['A', 'File.Contents("a.csv")'], ['B', 'Csv.Document(File.Contents("a.csv"))'], ['C', 'Web.Contents("http://x")'], ['D', 'Web.Contents(u)'], ['E', '1']]));
  const rows = [...inv.sources.values()].map((s) => [s.id, s.queries]);
  assert.deepEqual(rows, [['file:a.csv', ['A', 'B']], ['web:http://x', ['C']], ['dynamic:Web.Contents', ['D']]]);
  assert.deepEqual(bindingKeysOf(inv, 'B'), ['a.csv']);
  assert.deepEqual(bindingKeysOf(inv, 'E'), []);
  assert.deepEqual(bindingKeysOf(inv, 'D'), []);
});

test('T-WB-19: unbound lists literal bindable sources that have no binding, and dynamic ones are left to run time', () => {
  const inv = sourcesOfSection(section([['A', 'File.Contents("a.csv")'], ['B', 'File.Contents("b.csv")'], ['C', 'File.Contents(x)'], ['D', 'Sql.Database("s", "d")']]));
  assert.deepEqual(unbound(inv, ['a.csv']).map((s) => s.key), ['b.csv']);
  assert.deepEqual(unbound(inv, new Set(['a.csv', 'b.csv'])), []);
});

test('T-WB-19: a member that does not parse has no sources and does not stop the others', () => {
  const inv = sourcesOfSection(section([['Bad', 'let x = in x'], ['Good', 'File.Contents("g.csv")']]));
  assert.deepEqual(inv.byQuery.get('Bad'), []);
  assert.deepEqual([...inv.sources.keys()], ['file:g.csv']);
});

test('T-WB-19: the key shown is the key the engine asks for', () => {
  for (const [expr, kind] of [['Csv.Document(File.Contents("c:\\in\\a b.csv"))', 'file'], ['Json.Document(Web.Contents("https://example.com/a?x=1&y=2"))', 'web']]) {
    const text = section([['Q', expr]]);
    const r = runOnce({ ...baseOptions, sectionText: text, queryName: 'Q' });
    assert.equal(r.status, 'need-binding');
    const inv = sourcesOfSection(text);
    const [s] = [...inv.sources.values()];
    assert.equal(s.key, r.key);
    assert.equal(s.kind, r.kind);
    assert.equal(kind, r.kind);
  }
});
