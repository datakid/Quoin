import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseCalls, definitionOf } from '../../src/core/vba/refs.js';

const mod = (name, kind, ...lines) => ({ name, kind, text: lines.join('\r\n') });
const callers = (g, key) => [...g.calledBy.get(key)].sort();

const M1 = mod('Module1', 'standard',
  'Option Explicit',
  'Public Sub Main()',
  '  Call Helper',
  '  Worker 3',
  '  x = Compute(2) + 1',
  '  Module2.Remote',
  '  Application.Run "Module2.Remote2"',
  'End Sub',
  'Private Sub Helper()',
  'End Sub',
  'Public Sub Worker(n As Long)',
  'End Sub',
  'Public Function Compute(n As Long) As Long',
  '  Compute = n',
  'End Function',
  'Public Sub Lonely()',
  'End Sub');
const M2 = mod('Module2', 'standard',
  'Public Sub Remote()',
  'End Sub',
  'Public Sub Remote2()',
  'End Sub',
  'Private Sub Helper()',
  'End Sub',
  'Public Sub UsesLocal()',
  '  Dim Worker As Long',
  '  Worker = 1',
  'End Sub',
  'Public Sub CallsPrivateNames()',
  '  Helper',
  'End Sub');

test('T-WB-24: Call X, bare X arg, X(arg) in an expression, Module.X and Application.Run are all calls', () => {
  const g = analyseCalls([M1, M2]);
  assert.deepEqual([...g.calls.get('Module1.Main')].sort(), ['Module1.Compute', 'Module1.Helper', 'Module1.Worker', 'Module2.Remote', 'Module2.Remote2']);
  assert.deepEqual(callers(g, 'Module2.Remote2'), ['Module1.Main']);
});

test('T-WB-24: a local variable with the name of a procedure is not a call', () => {
  const g = analyseCalls([M1, M2]);
  assert.deepEqual([...g.calls.get('Module2.UsesLocal')], []);
  assert.deepEqual(callers(g, 'Module1.Worker'), ['Module1.Main']);
});

test('T-WB-24: a private procedure is only visible inside its own module, and the nearest one wins', () => {
  const g = analyseCalls([M1, M2]);
  assert.deepEqual(callers(g, 'Module1.Helper'), ['Module1.Main']);
  assert.deepEqual(callers(g, 'Module2.Helper'), ['Module2.CallsPrivateNames']);
});

test('T-WB-24: a function assigning its own name is not a recursive call', () => {
  const g = analyseCalls([M1, M2]);
  assert.deepEqual(callers(g, 'Module1.Compute'), ['Module1.Main']);
});

test('T-WB-24: strings and comments never create a call', () => {
  const g = analyseCalls([mod('A', 'standard', 'Sub One()', '  s = "Two"', "  \' Two", '  Rem Two', '  Debug.Print "call Two now"', 'End Sub', 'Sub Two()', 'End Sub')]);
  assert.deepEqual(callers(g, 'A.Two'), []);
});

test('T-WB-24: a member access with the name of a procedure is not a call', () => {
  const g = analyseCalls([mod('A', 'standard', 'Sub One()', '  obj.Two', '  With obj', '    .Two', '  End With', 'End Sub', 'Sub Two()', 'End Sub')]);
  assert.deepEqual(callers(g, 'A.Two'), []);
});

test('T-WB-24: procedures nobody calls are listed, event handlers are not, with the lines of every reference', () => {
  const doc = mod('ThisWorkbook', 'document', 'Private Sub Workbook_Open()', '  Main', 'End Sub');
  const g = analyseCalls([M1, M2, doc]);
  assert.ok(g.noCallers.includes('Module1.Lonely'));
  assert.ok(!g.noCallers.includes('ThisWorkbook.Workbook_Open'));
  assert.ok(!g.noCallers.includes('Module1.Worker'));
  const refs = g.refs.get('Module1.Worker');
  assert.equal(refs.length, 1);
  assert.deepEqual([refs[0].module, refs[0].line, refs[0].from], ['Module1', 4, 'Module1.Main']);
});

test('T-WB-24: Application.Run accepts a bare name, a workbook prefix and a doubled quote', () => {
  const g = analyseCalls([mod('A', 'standard', 'Sub One()', '  Application.Run "Two"', "  Application.Run \"\'Book.xlsm\'!B.Three\"", 'End Sub', 'Sub Two()', 'End Sub'), mod('B', 'standard', 'Public Sub Three()', 'End Sub')]);
  assert.deepEqual([...g.calls.get('A.One')].sort(), ['A.Two', 'B.Three']);
});

test('T-WB-24: Option Private Module hides public procedures from other modules', () => {
  const g = analyseCalls([mod('P', 'standard', 'Option Private Module', 'Public Sub Hidden()', 'End Sub'), mod('Q', 'standard', 'Sub Use()', '  Hidden', 'End Sub')]);
  assert.deepEqual(callers(g, 'P.Hidden'), []);
});

test('T-WB-24: go to definition prefers the module itself, then a public one', () => {
  const g = analyseCalls([M1, M2]);
  assert.equal(definitionOf(g, 'helper', 'Module2').key, 'Module2.Helper');
  assert.equal(definitionOf(g, 'worker', 'Module2').key, 'Module1.Worker');
  assert.equal(definitionOf(g, 'nothing', 'Module2'), null);
});

test('T-WB-24: a property pair is one procedure with several kinds', () => {
  const g = analyseCalls([mod('C', 'class', 'Public Property Get Name() As String', 'End Property', 'Public Property Let Name(v As String)', 'End Property', 'Sub Use()', '  x = Name', 'End Sub')]);
  assert.deepEqual(g.procs.get('C.Name').kinds, ['property-get', 'property-let']);
  assert.deepEqual(callers(g, 'C.Name'), ['C.Use']);
});
