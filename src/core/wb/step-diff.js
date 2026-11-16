import { stepsOf } from './steps.js';
import { matchProcedures } from '../vba/proc-diff.js';

function normalised(text, st) {
  let out = text.slice(st.exprSpan.start, st.exprSpan.end);
  const base = st.exprSpan.start;
  for (const r of [...st.refs].sort((a, b) => b.start - a.start)) out = `${out.slice(0, r.start - base)}\u00a7${out.slice(r.end - base)}`;
  return out.replace(/\s+/g, ' ').trim();
}

function longestIncreasing(seq) {
  const tails = [];
  const prev = new Array(seq.length).fill(-1);
  const idx = [];
  for (let i = 0; i < seq.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]] < seq[i]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
    idx[lo] = i;
  }
  const keep = new Set();
  let k = tails.length ? tails[tails.length - 1] : -1;
  while (k >= 0) {
    keep.add(k);
    k = prev[k];
  }
  return keep;
}

export function diffSteps(originalText, currentText) {
  const o = stepsOf(originalText, 0);
  const c = stepsOf(currentText, 0);
  if (o.shape !== 'let' || c.shape !== 'let') return { comparable: false, rows: [] };
  const oByName = new Map(o.steps.map((s) => [s.name, s]));
  const cByName = new Map(c.steps.map((s) => [s.name, s]));
  const rows = [];
  const common = c.steps.filter((s) => oByName.has(s.name));
  const order = common.map((s) => oByName.get(s.name).index);
  const keep = longestIncreasing(order);
  common.forEach((s, i) => {
    if (keep.has(i)) return;
    const after = c.steps.slice(s.index + 1).find((x) => oByName.has(x.name));
    rows.push({ kind: 'reordered', step: s.name, before: after ? after.name : null });
  });
  for (const s of c.steps) if (!oByName.has(s.name)) rows.push({ kind: 'added', step: s.name });
  for (const s of o.steps) if (!cByName.has(s.name)) rows.push({ kind: 'removed', step: s.name });
  for (const s of common) {
    const before = oByName.get(s.name);
    if (s.bypassed && !before.bypassed) rows.push({ kind: 'bypassed', step: s.name });
    else if (!s.bypassed && before.bypassed) rows.push({ kind: 'restored', step: s.name });
  }
  for (const s of common) {
    const before = oByName.get(s.name);
    if (normalised(originalText, before) !== normalised(currentText, s)) rows.push({ kind: 'changed', step: s.name });
  }
  return { comparable: true, rows };
}

export function diffProcedures(originalText, currentText, moduleKind = 'standard') {
  const { rows, removed } = matchProcedures(originalText, currentText, moduleKind);
  return { edited: rows.filter((r) => r.status === 'edited').map((r) => r.name), added: rows.filter((r) => r.status === 'added').map((r) => r.name), removed: removed.map((r) => r.name) };
}
