import { parseExpressionText } from '../m/parser.js';
import { freeRefs } from './ast-walk.js';
import { stepsOf } from './steps.js';
import { bindingKeysOf } from './sources.js';
import { outlineModule } from '../vba/outline.js';
import { structureProblems } from '../vba/structure.js';

export const SEVERITY = { error: 0, warning: 1, info: 2 };

const SEVERITY_OF = {
  'm.parse': 'error',
  'm.unresolved': 'error',
  'm.cycle': 'error',
  'm.unsupported': 'warning',
  'm.external': 'info',
  'm.forwardRef': 'warning',
  'm.lastRun': 'error',
  'vba.structure': 'error',
  'vba.duplicate': 'error',
  'vba.exit': 'warning',
  'vba.noExplicit': 'info'
};

export function lineCol(text, offset) {
  const upto = text.slice(0, Math.max(0, offset));
  const nl = upto.split(/\r\n|\r|\n/);
  return { line: nl.length, col: nl[nl.length - 1].length + 1 };
}

const sevOf = (code) => SEVERITY_OF[code] || 'error';

function row(code, item, pos, where, args) {
  return { code, severity: sevOf(code), item, line: pos.line, col: pos.col, where: where || null, args: args || {} };
}

export function problemsForQuery(name, ctx) {
  const member = ctx.index.members.find((m) => m.name === name);
  if (!member) return [];
  const item = { type: 'query', name };
  const text = ctx.sectionText.slice(member.exprStart, member.exprEnd);
  const at = (abs) => lineCol(text, abs - member.exprStart);
  const out = [];
  if (member.parseError) out.push(row('m.parse', item, at(member.parseError.start), null, { message: member.parseError.message }));
  for (const u of member.unresolved || []) out.push(row('m.unresolved', item, at(u.start), null, { name: u.ident }));
  for (const cycle of ctx.index.cycles) if (cycle.includes(name)) out.push(row('m.cycle', item, { line: 1, col: 1 }, null, { members: cycle }));
  let ast = null;
  if (!member.parseError) {
    try {
      ast = parseExpressionText(text, 0);
    } catch {
      ast = null;
    }
  }
  if (ast && ctx.libNames) {
    const seen = new Set();
    for (const r of freeRefs(ast)) {
      if (r.kind !== 'identifier' || !r.name.includes('.') || r.name.startsWith('#') || ctx.libNames.has(r.name) || ctx.index.refs.has(r.name) || seen.has(r.name)) continue;
      seen.add(r.name);
      out.push(row('m.unsupported', item, lineCol(text, r.start), null, { name: r.name }));
    }
  }
  if (ctx.sources) {
    const bound = ctx.bound || new Set();
    const keys = new Set(bindingKeysOf(ctx.sources, name));
    for (const f of ctx.sources.byQuery.get(name) || []) {
      if (f.bindable && f.key !== null && keys.has(f.key) && !bound.has(f.key)) {
        keys.delete(f.key);
        out.push(row('m.external', item, lineCol(text, f.start - member.exprStart), null, { key: f.key, kind: f.kind }));
      }
    }
  }
  if (ast && ast.t !== undefined) {
    const model = stepsOf(text, 0);
    for (const st of model.steps || []) {
      for (const ref of st.forward) out.push(row('m.forwardRef', item, lineCol(text, st.nameSpan.start), st.name, { step: st.name, ref }));
    }
  }
  const last = ctx.lastRun && ctx.lastRun.get(name);
  if (last) out.push(row('m.lastRun', item, { line: 1, col: 1 }, null, { message: last.message || '' }));
  return out;
}

export function problemsForModule(mod, ctx = {}) {
  const item = { type: 'module', name: mod.name };
  const kind = mod.kind === 'standard' || mod.kind === 'class' ? mod.kind : 'document';
  const o = outlineModule(mod.text, { moduleKind: kind });
  const whereAt = (line) => {
    const p = o.procedures.find((x) => line >= x.startLine && line <= x.endLine);
    return p ? p.name : null;
  };
  const out = [];
  for (const p of structureProblems(mod.text)) out.push(row(p.code, item, { line: p.line, col: p.col }, whereAt(p.line), p.args));
  for (const p of o.problems) {
    if (p.code === 'unterminated-procedure' || p.code === 'stray-end' || p.code === 'mismatched-end') continue;
    out.push(row('vba.structure', item, { line: p.line, col: p.col }, whereAt(p.line), { kind: p.code }));
  }
  if (ctx.validate) for (const p of ctx.validate(mod) || []) out.push(row(p.code, item, { line: p.line, col: p.col }, whereAt(p.line), { char: p.char, n: p.n, max: p.max }));
  if (!o.options.explicit && (o.procedures.length || o.declarations.length)) out.push(row('vba.noExplicit', item, { line: 1, col: 1 }, null, {}));
  return out;
}

export function sortProblems(rows, order = new Map()) {
  return rows.slice().sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity] || (order.get(a.item.name) ?? 1e9) - (order.get(b.item.name) ?? 1e9) || a.line - b.line || a.col - b.col);
}

export function collectProblems(ctx) {
  const rows = [];
  for (const m of ctx.index.members) rows.push(...problemsForQuery(m.name, ctx));
  for (const mod of ctx.modules || []) rows.push(...problemsForModule(mod, ctx));
  const order = new Map([...ctx.index.members.map((m) => m.name), ...(ctx.modules || []).map((m) => m.name)].map((n, i) => [n, i]));
  return sortProblems(rows, order);
}

export function filterProblems(rows, { severities = null, itemType = null } = {}) {
  return rows.filter((r) => (!severities || severities.includes(r.severity)) && (!itemType || r.item.type === itemType));
}

export function countProblems(rows) {
  const c = { error: 0, warning: 0, info: 0 };
  for (const r of rows) c[r.severity]++;
  return c;
}
