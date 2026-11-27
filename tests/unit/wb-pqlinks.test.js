import test from 'node:test';
import assert from 'node:assert/strict';
import { scanProcedureLinks, pqLinksOfModule, resolveLinks, runPlanOf, refreshedBy } from '../../src/core/vba/pq-links.js';

const proc = (...lines) => scanProcedureLinks(lines.join('\r\n'));
const brief = (ls) => ls.map((l) => [l.kind, l.via, l.name, l.dynamic, l.line]);

test('T-WB-25: Connections("Query - Name").Refresh resolves to the query Name', () => {
  assert.deepEqual(brief(proc('ThisWorkbook.Connections("Query - Sales").Refresh')), [['refresh', 'connection', 'Sales', false, 1]]);
  assert.deepEqual(brief(proc('Me.Connections("Query - Sales").OLEDBConnection.Refresh')), [['refresh', 'connection', 'Sales', false, 1]]);
});

test('T-WB-25: ListObjects(...).QueryTable.Refresh names a table', () => {
  assert.deepEqual(brief(proc('Sheet1.ListObjects("Table1").QueryTable.Refresh BackgroundQuery:=False')), [['refresh', 'table', 'Table1', false, 1]]);
});

test('T-WB-25: Queries("Name") is a read or modify link, not a refresh', () => {
  assert.deepEqual(brief(proc('s = ActiveWorkbook.Queries("Sales").Formula')), [['read', 'queries', 'Sales', false, 1]]);
});

test('T-WB-25: RefreshAll links every loaded query', () => {
  assert.deepEqual(brief(proc('ThisWorkbook.RefreshAll')), [['all', 'all', null, false, 1]]);
});

test('T-WB-25: a non-literal argument is dynamic', () => {
  assert.deepEqual(brief(proc('ThisWorkbook.Connections("Query - " & n).Refresh', 'ActiveWorkbook.Queries(nm).Delete')), [['refresh', 'connection', null, true, 1], ['read', 'queries', null, true, 2]]);
});

test('T-WB-25: a With block expands leading-dot members', () => {
  const ls = proc('With ThisWorkbook.Connections("Query - A")', '  .Refresh', 'End With', 'With ThisWorkbook', '  .Connections("Query - B").Refresh', '  .RefreshAll', 'End With');
  assert.deepEqual(brief(ls), [['refresh', 'connection', 'A', false, 2], ['refresh', 'connection', 'B', false, 5], ['all', 'all', null, false, 6]]);
});

test('T-WB-25: nested With blocks use the innermost expression', () => {
  const ls = proc('With ThisWorkbook', '  With .Connections("Query - Z")', '    .Refresh', '  End With', 'End With');
  assert.deepEqual(brief(ls), [['refresh', 'connection', 'Z', false, 3]]);
});

test('T-WB-25: line continuations and colon separators are joined and split', () => {
  const ls = proc('ThisWorkbook _', '  .Connections("Query - Long") _', '  .Refresh', 'x = 1: ThisWorkbook.Connections("Query - B").Refresh: y = 2');
  assert.deepEqual(brief(ls), [['refresh', 'connection', 'Long', false, 1], ['refresh', 'connection', 'B', false, 4]]);
});

test('T-WB-25: comments and strings that only mention a pattern are ignored, and the match is case-insensitive', () => {
  assert.deepEqual(proc("' ThisWorkbook.Connections(\"Query - X\").Refresh", 'Debug.Print "ThisWorkbook.RefreshAll"'), []);
  assert.deepEqual(brief(proc('thisworkbook.connections("Query - Low").refresh')), [['refresh', 'connection', 'Low', false, 1]]);
});

test('T-WB-25: a doubled quote inside the name is read as one quote', () => {
  assert.deepEqual(brief(proc('ThisWorkbook.Connections("Query - Say ""hi""").Refresh')), [['refresh', 'connection', 'Say "hi"', false, 1]]);
});

test('T-WB-25: a module is scanned per procedure with file line numbers', () => {
  const text = ['Option Explicit', 'Public Sub RefreshSales()', '  ThisWorkbook.Connections("Query - Sales").Refresh', 'End Sub', 'Public Sub Other()', '  x = 1', 'End Sub', 'Public Sub RefreshAll2()', '  ThisWorkbook.RefreshAll', 'End Sub'].join('\r\n');
  const m = pqLinksOfModule(text);
  assert.deepEqual([...m.keys()], ['RefreshSales', 'RefreshAll2']);
  assert.equal(m.get('RefreshSales')[0].line, 3);
  assert.equal(m.get('RefreshAll2')[0].line, 9);
});

const CTX = { queries: ['Sales', 'Regions', 'Summary'], loaded: ['Summary', 'Sales'], queryOfTable: (t) => (t === 'Table1' ? 'Sales' : null) };

test('T-WB-25: links resolve against the queries, tables map through the load target, unknown names are flagged', () => {
  const r = resolveLinks(proc('ThisWorkbook.Connections("Query - Sales").Refresh', 'Sheet1.ListObjects("Table1").QueryTable.Refresh', 'ThisWorkbook.Connections("Query - Ghost").Refresh', 'ThisWorkbook.RefreshAll', 'x = ThisWorkbook.Queries("Regions").Formula', 'Sheet1.ListObjects("Nope").QueryTable.Refresh'), CTX);
  assert.deepEqual(r.map((x) => [x.queries, x.unknown]), [[['Sales'], false], [['Sales'], false], [[], true], [['Summary', 'Sales'], false], [['Regions'], false], [[], true]]);
});

test('T-WB-25: the run plan lists refreshed queries in the macro order without duplicates, and reports the rest', () => {
  const r = resolveLinks(proc('ThisWorkbook.Connections("Query - Regions").Refresh', 'ThisWorkbook.Connections("Query - Sales").Refresh', 'ThisWorkbook.Connections("Query - " & n).Refresh', 'ThisWorkbook.Connections("Query - Ghost").Refresh', 'x = ThisWorkbook.Queries("Summary").Formula', 'ThisWorkbook.Connections("Query - Regions").Refresh'), CTX);
  const plan = runPlanOf(r);
  assert.deepEqual(plan.names, ['Regions', 'Sales']);
  assert.deepEqual(plan.dynamic.map((d) => d.line), [3]);
  assert.deepEqual(plan.unknown.map((u) => u.name), ['Ghost']);
});

test('T-WB-25: RefreshAll in the middle puts every loaded query in loaded order at that point', () => {
  const plan = runPlanOf(resolveLinks(proc('ThisWorkbook.Connections("Query - Regions").Refresh', 'ThisWorkbook.RefreshAll'), CTX));
  assert.deepEqual(plan.names, ['Regions', 'Summary', 'Sales']);
});

test('T-WB-25: refreshedBy lists which procedures refresh a query', () => {
  const perModule = new Map([['Module1', pqLinksOfModule('Sub A()\r\n  ThisWorkbook.Connections("Query - Sales").Refresh\r\nEnd Sub\r\nSub B()\r\n  ThisWorkbook.RefreshAll\r\nEnd Sub')], ['Module2', pqLinksOfModule('Sub C()\r\n  ThisWorkbook.Connections("Query - Sales").Refresh\r\nEnd Sub')]]);
  const map = refreshedBy(perModule, CTX);
  assert.deepEqual(map.get('Sales'), ['Module1.A', 'Module1.B', 'Module2.C']);
  assert.deepEqual(map.get('Summary'), ['Module1.B']);
  assert.equal(map.has('Regions'), false);
});
