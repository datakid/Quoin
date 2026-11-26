import { S } from '../ui/strings.js';
import { diffSteps, diffProcedures } from '../core/wb/step-diff.js';

export function stepLines(original, current) {
  const d = diffSteps(original, current);
  const C = S.changeSummary;
  return d.rows.map((r) => (r.kind === 'reordered' ? C.reordered(r.step, r.before) : C[r.kind](r.step)));
}

export function procedureLines(original, current, moduleKind) {
  const d = diffProcedures(original, current, moduleKind);
  const C = S.changeSummary;
  const out = [];
  if (d.edited.length) out.push(C.edited(d.edited));
  if (d.added.length) out.push(C.addedProcs(d.added));
  if (d.removed.length) out.push(C.removedProcs(d.removed));
  return out;
}

export function summariesFor(changes, moduleKindOf) {
  const out = new Map();
  for (const [name, c] of changes.queries) out.set(name, stepLines(c.original, c.current));
  for (const [name, c] of changes.modules) out.set(name, procedureLines(c.original, c.current, moduleKindOf(name)));
  return out;
}
