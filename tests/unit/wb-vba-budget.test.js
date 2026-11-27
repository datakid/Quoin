import test from 'node:test';
import assert from 'node:assert/strict';
import { outlineModule } from '../../src/core/vba/outline.js';
import { structureProblems } from '../../src/core/vba/structure.js';
import { analyseCalls } from '../../src/core/vba/refs.js';

const MODULES = 60;
const PER_MODULE = 15;

function procedure(m, p, { broken = false } = {}) {
  const name = `Proc_${m}_${p}`;
  const next = `Proc_${m}_${(p + 1) % PER_MODULE}`;
  const other = `Proc_${(m + 1) % MODULES}_${p}`;
  const lines = [`Public Sub ${name}(ByVal n As Long)`, '    Dim i As Long, total As Long', '    total = 0'];
  for (let k = 0; k < 6; k++) {
    lines.push(`    For i = 1 To n + ${k}`, `        If i Mod ${k + 2} = 0 Then`, '            total = total + i', '        Else', '            total = total - 1', '        End If');
    lines.push(broken && k === 3 ? '    End If' : '    Next i');
  }
  lines.push(`    ${next} total`, `    If total > 1000 Then ${other} total`, '    Debug.Print "done"', 'End Sub', '');
  return lines;
}

function moduleText(m) {
  const lines = ['Option Explicit', ''];
  for (let p = 0; p < PER_MODULE; p++) lines.push(...procedure(m, p, { broken: m === 7 && p === 4 }));
  if (m === 12) lines.push('Public Sub Dup()', 'End Sub', '', 'Public Sub Dup()', 'End Sub', '');
  return lines.join('\r\n');
}

const modules = Array.from({ length: MODULES }, (_, m) => ({ name: `Module${m}`, kind: 'standard', text: moduleText(m) }));
const totalLines = modules.reduce((n, mod) => n + mod.text.split('\r\n').length, 0);

function timed(fn) {
  const t0 = performance.now();
  const out = fn();
  return { out, ms: performance.now() - t0 };
}

test('T-WB-27: the synthetic VBA project has the size the budget describes', () => {
  assert.equal(modules.length, 60);
  assert.ok(totalLines > 30000, `lines ${totalLines}`);
});

test('T-WB-27: outlining 60 modules and about 900 procedures finds every procedure and stays within budget', () => {
  const { out, ms } = timed(() => modules.map((m) => outlineModule(m.text, { moduleKind: 'standard' })));
  const procs = out.reduce((n, o) => n + o.procedures.length, 0);
  console.log(`vba outline: ${modules.length} modules, ${totalLines} lines, ${procs} procedures, ${ms.toFixed(0)} ms`);
  assert.equal(procs, MODULES * PER_MODULE + 2);
  assert.ok(ms <= 2000, `outline took ${ms.toFixed(0)} ms`);
});

test('T-WB-27: the structure check over every module reports the one broken block (a mismatch and its stray End If) and the one duplicate, within budget', () => {
  const { out, ms } = timed(() => modules.flatMap((m) => structureProblems(m.text).map((p) => ({ ...p, module: m.name }))));
  console.log(`vba structure: ${out.length} problems, ${ms.toFixed(0)} ms`);
  assert.equal(out.filter((p) => p.code === 'vba.duplicate').length, 1);
  assert.equal(out.filter((p) => p.code === 'vba.duplicate')[0].module, 'Module12');
  const structural = out.filter((p) => p.code === 'vba.structure');
  assert.deepEqual(structural.map((p) => [p.module, p.args.kind]), [['Module7', 'mismatch'], ['Module7', 'stray']]);
  assert.ok(ms <= 2000, `structure took ${ms.toFixed(0)} ms`);
});

test('T-WB-27: the call analysis over 60 modules links the procedures and stays within budget', () => {
  const { out, ms } = timed(() => analyseCalls(modules));
  console.log(`vba calls: ${out.procs.size} procedures, ${ms.toFixed(0)} ms`);
  assert.equal(out.procs.size, MODULES * PER_MODULE + 1);
  const calledBy = out.calledBy.get('Module3.Proc_3_4');
  assert.ok(calledBy.has('Module3.Proc_3_3'));
  assert.ok(calledBy.has('Module2.Proc_2_4'));
  assert.ok(ms <= 4000, `calls took ${ms.toFixed(0)} ms`);
});
