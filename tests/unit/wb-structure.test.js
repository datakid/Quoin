import test from 'node:test';
import assert from 'node:assert/strict';
import { structureProblems } from '../../src/core/vba/structure.js';

const check = (...lines) => structureProblems(lines.join('\n'));
const codes = (ps) => ps.map((p) => `${p.code}:${p.line}`);

test('T-WB-23: balanced blocks of every kind report nothing', () => {
  assert.deepEqual(check(
    'Option Explicit',
    'Public Sub A()',
    '  If x Then',
    '    y = 1',
    '  ElseIf z Then',
    '    y = 2',
    '  Else',
    '    y = 3',
    '  End If',
    '  For i = 1 To 3',
    '    For Each c In cells',
    '    Next c',
    '  Next i',
    '  Do While k < 3',
    '    k = k + 1',
    '  Loop',
    '  Do',
    '  Loop Until k > 9',
    '  While a',
    '  Wend',
    '  With obj',
    '    .x = 1',
    '  End With',
    '  Select Case v',
    '    Case 1',
    '    Case Else',
    '  End Select',
    'End Sub',
    'Private Type T',
    '  a As Long',
    'End Type',
    'Public Enum E',
    '  One',
    'End Enum',
    'Function F() As Long',
    'End Function',
    'Property Get P() As Long',
    'End Property'
  ), []);
});

test('T-WB-23: a block closed by the wrong word names both lines', () => {
  const ps = check('Sub A()', '  If a Then', '    For i = 1 To 3', '      x = i', '    End If', '  Next i', 'End Sub');
  assert.deepEqual(ps.map((p) => [p.code, p.line, p.args.kind, p.args.open, p.args.openLine, p.args.found, p.args.foundLine]), [['vba.structure', 3, 'mismatch', 'For', 3, 'End If', 5]]);
});

test('T-WB-23: an End If with no If is stray, and an If with no End If is unclosed at the end of the module', () => {
  assert.deepEqual(check('Sub A()', '  x = 1', '  End If', 'End Sub').map((p) => [p.line, p.args.kind, p.args.found]), [[3, 'stray', 'End If']]);
  const open = check('Sub A()', '  If x Then', '    y = 1', 'End Sub');
  assert.deepEqual(open.map((p) => [p.line, p.args.kind, p.args.open, p.args.found]), [[2, 'mismatch', 'If', 'End Sub']]);
  const end = check('Sub A()', '  If x Then', '    y = 1');
  assert.deepEqual(end.map((p) => p.args.kind).sort(), ['unclosed', 'unclosed']);
});

test('T-WB-23: a single-line If is not a block, even with an Else or a colon', () => {
  assert.deepEqual(check('Sub A()', '  If x Then y = 1', '  If x Then y = 1 Else y = 2', '  If x Then: y = 1', 'End Sub'), []);
  assert.deepEqual(check('Sub A()', '  If x _', '      And y Then', '    z = 1', '  End If', 'End Sub'), []);
  assert.deepEqual(check('Sub A()', '  If x Then _', '    y = 1', 'End Sub'), []);
});

test('T-WB-23: nested blocks close inside out and a crossing is reported once', () => {
  assert.deepEqual(check('Sub A()', '  For i = 1 To 2', '    With o', '    Next i', '  End With', 'End Sub').map((p) => [p.line, p.args.kind, p.args.open, p.args.found]), [[3, 'mismatch', 'With', 'Next']]);
  assert.deepEqual(check('Sub A()', '  If a Then', '    If b Then', '    End If', '  End If', 'End Sub'), []);
});

test('T-WB-23: Next with several counters closes several For blocks', () => {
  assert.deepEqual(check('Sub A()', '  For i = 1 To 2', '    For j = 1 To 2', '    Next j, i', 'End Sub'), []);
  assert.deepEqual(check('Sub A()', '  For i = 1 To 2', '    For j = 1 To 2', '    Next j, i, k', 'End Sub').map((p) => [p.args.kind, p.args.found]), [['stray', 'Next']]);
});

test('T-WB-23: strings, comments, labels, colons and Open ... For do not look like blocks', () => {
  assert.deepEqual(check('Sub A()', '  s = "If x Then"', "  \' For i = 1 To 3", '  Rem With obj', 'Lbl:', '  x = 1: y = 2', '  Open "f.txt" For Output As #1', '  Close #1', '  Debug.Print "End Sub"', 'End Sub'), []);
});

test('T-WB-23: a Declare is not a Sub and Exit Sub is not an opener', () => {
  assert.deepEqual(check('Private Declare PtrSafe Sub Sleep Lib "kernel32" (ByVal ms As Long)', 'Sub A()', '  Exit Sub', 'End Sub'), []);
});

test('T-WB-23: one-line procedures balance', () => {
  assert.deepEqual(check('Private Function Calc(x As Double) As Double: Calc = x: End Function', 'Sub B()', 'End Sub'), []);
});

test('T-WB-23: a duplicate procedure name is reported, a Property Get and Let pair is not', () => {
  const ps = check('Sub A()', 'End Sub', 'Sub a()', 'End Sub', 'Property Get P()', 'End Property', 'Property Let P(v)', 'End Property');
  assert.deepEqual(ps.map((p) => [p.code, p.line, p.args.name, p.args.firstLine]), [['vba.duplicate', 3, 'a', 1]]);
});

test('T-WB-23: Exit Function inside a Sub and Exit Sub inside a Function are reported', () => {
  const ps = check('Sub A()', '  Exit Function', 'End Sub', 'Function F()', '  Exit Sub', '  Exit Function', 'End Function', 'Property Get P()', '  Exit Property', 'End Property');
  assert.deepEqual(ps.map((p) => [p.code, p.line, p.args.exit, p.args.inside]), [['vba.exit', 2, 'Exit Function', 'sub'], ['vba.exit', 5, 'Exit Sub', 'function']]);
});

test('T-WB-23: positions come from the first physical line of a continued statement, CRLF included', () => {
  const ps = structureProblems('Sub A()\r\n  For i = 1 _\r\n    To 3\r\nEnd Sub');
  assert.deepEqual(ps.map((p) => [p.line, p.args.open, p.args.found]), [[2, 'For', 'End Sub']]);
});

test('T-WB-23: every module of the fixtures is checked without throwing and well-formed ones report nothing structural', async () => {
  const { openWorkbook } = await import('../../src/core/workbook.js');
  const { readdirSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { fixture } = await import('./helpers.js');
  const dir = fileURLToPath(new URL('../fixtures/external/', import.meta.url));
  let seen = 0;
  for (const f of readdirSync(dir).filter((x) => /\.xlsm$/.test(x))) {
    const wb = await openWorkbook(fixture(f), f);
    if (!wb.vba || !wb.vba.project) continue;
    for (const m of wb.vba.project.modules) {
      if (m.error || !m.model) continue;
      const ps = structureProblems(m.model.visible);
      assert.deepEqual(ps.filter((p) => p.code === 'vba.structure'), [], `${f} ${m.name}`);
      seen++;
    }
  }
  assert.ok(seen >= 5);
});
