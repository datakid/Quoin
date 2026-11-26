import { lex } from '../m/lexer.js';
import { rank } from './fuzzy.js';
import { quoteIdent } from './ident.js';

export const KEYWORDS_OFFERED = ['each', 'let', 'in', 'if', 'then', 'else', 'try', 'otherwise', 'and', 'or', 'not', 'true', 'false', 'null', 'type', 'error'];
export const MAX_ITEMS = 50;

const TRIVIA = new Set(['ws', 'comment']);
const OPEN = { '(': ')', '[': ']', '{': '}' };
const NAME_KINDS = new Set(['ident', 'qident']);

function significant(tokens) {
  return tokens.filter((t) => !TRIVIA.has(t.kind));
}

function frameAt(tokens, caret) {
  const stack = [];
  for (const t of tokens) {
    if (t.end > caret) break;
    if (t.kind !== 'op') continue;
    if (OPEN[t.value]) stack.push({ open: t.value, token: t, commas: 0 });
    else if (t.value === ')' || t.value === ']' || t.value === '}') stack.pop();
    else if (t.value === ',' && stack.length) stack[stack.length - 1].commas++;
  }
  return stack;
}

export function completionContext(text, caret) {
  const tokens = lex(text);
  const sig = significant(tokens);
  for (const t of tokens) {
    if (t.kind === 'comment' && t.start < caret && caret <= t.end && !/[\r\n]/.test(text.slice(t.start, caret))) return null;
    if (t.kind === 'string' && t.start < caret && caret < t.end) return null;
    if (t.kind === 'error' && text[t.start] === '"' && t.start < caret && caret <= t.end) return null;
  }
  const stack = frameAt(sig, caret);
  const top = stack.length ? stack[stack.length - 1] : null;
  if (top && top.open === '[') {
    const start = top.token.end;
    return { kind: 'column', start, end: caret, prefix: text.slice(start, caret).replace(/^\s+/, '').replace(/^#"/, ''), explicit: false };
  }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if ((t.kind === 'ident' || t.kind === 'keyword') && t.start < caret && caret <= t.end) {
      return { kind: 'name', start: t.start, end: caret, prefix: text.slice(t.start, caret) };
    }
    if (t.kind === 'error' && t.value === '.' && t.start === caret - 1) {
      const prev = tokens[i - 1];
      if (prev && prev.kind === 'ident' && prev.end === t.start) return { kind: 'name', start: prev.start, end: caret, prefix: `${prev.value}.` };
    }
    if (t.kind === 'error' && text.startsWith('#"', t.start) && t.start < caret && caret <= t.end) {
      return { kind: 'name', start: t.start, end: caret, prefix: text.slice(t.start + 2, caret), quoted: true };
    }
  }
  return { kind: 'name', start: caret, end: caret, prefix: '' };
}

export function shouldAutoComplete(ctx) {
  if (!ctx) return false;
  if (ctx.kind === 'column') return true;
  return ctx.prefix.length >= 2 || ctx.prefix.endsWith('.');
}

export function stepsInScope(steps, caret) {
  const at = steps.findIndex((s) => caret >= s.exprSpan.start && caret <= s.exprSpan.end);
  if (at >= 0) return steps.slice(0, at);
  const nameAt = steps.findIndex((s) => caret >= s.nameSpan.start && caret <= s.nameSpan.end);
  if (nameAt >= 0) return steps.slice(0, nameAt);
  const after = steps.filter((s) => s.exprSpan.end <= caret);
  return after;
}

export function completionItems(ctx, env) {
  if (!ctx) return [];
  const items = [];
  if (ctx.kind === 'column') {
    for (const c of env.columns || []) items.push({ label: c, insert: quoteIdent(c), kind: 'column', detail: '' });
  } else {
    const seen = new Set();
    for (const s of env.scope || env.steps || []) {
      seen.add(s.name);
      items.push({ label: s.name, insert: quoteIdent(s.name), kind: 'step', detail: s.kind || '' });
    }
    for (const q of env.members || []) {
      if (q === env.current || seen.has(q)) continue;
      items.push({ label: q, insert: quoteIdent(q), kind: 'query', detail: '' });
    }
    for (const [name, params, category] of env.names || []) items.push({ label: name, insert: name, kind: params === null ? 'constant' : 'function', detail: category, params });
    for (const k of KEYWORDS_OFFERED) items.push({ label: k, insert: k, kind: 'keyword', detail: '' });
  }
  const ranked = rank(ctx.prefix, items, (i) => i.label, MAX_ITEMS);
  return ranked.map((r) => ({ ...r.item, ranges: r.ranges }));
}

export function parseParams(spec) {
  if (spec === null || spec === undefined) return null;
  return spec === '' ? [] : spec.split(',').map((p) => (p.startsWith('?') ? { name: p.slice(1), optional: true } : { name: p, optional: false }));
}

export function signatureAt(text, caret, names) {
  const tokens = lex(text);
  const sig = significant(tokens);
  const stack = frameAt(sig, caret);
  for (let i = stack.length - 1; i >= 0; i--) {
    const f = stack[i];
    if (f.open !== '(') continue;
    const idx = sig.indexOf(f.token);
    const prev = sig[idx - 1];
    if (!prev || !NAME_KINDS.has(prev.kind)) return null;
    const row = names.get(prev.value);
    if (!row) return null;
    const params = parseParams(row[1]);
    if (!params) return null;
    return { name: prev.value, params, active: Math.min(f.commas, Math.max(0, params.length - 1)), over: f.commas >= params.length, start: prev.start };
  }
  return null;
}

export function signatureText(sig) {
  return `${sig.name}(${sig.params.map((p) => (p.optional ? `[${p.name}]` : p.name)).join(', ')})`;
}

export function nameAt(text, offset) {
  const tokens = lex(text);
  for (const t of tokens) {
    if (NAME_KINDS.has(t.kind) && t.start <= offset && offset <= t.end) return t;
  }
  return null;
}

export function definitionAt(text, offset, env) {
  const tok = nameAt(text, offset);
  if (!tok) return null;
  const name = tok.value;
  const step = (env.steps || []).find((s) => s.name === name);
  if (step) return { kind: 'step', name, offset: step.nameSpan.start, here: tok.start === step.nameSpan.start };
  if ((env.members || []).includes(name) && name !== env.current) return { kind: 'query', name };
  const row = env.names && env.names.get(name);
  if (row) {
    const params = parseParams(row[1]);
    return { kind: params === null ? 'constant' : 'function', name, params, category: row[2] };
  }
  return null;
}

export function referencesIn(name, docs, { skipDefinition = null } = {}) {
  const out = [];
  for (const doc of docs) {
    const lines = doc.text.split(/\r\n|\r|\n/);
    for (const t of lex(doc.text)) {
      if (!NAME_KINDS.has(t.kind) || t.value !== name) continue;
      if (skipDefinition && skipDefinition.query === doc.name && skipDefinition.start === t.start) continue;
      out.push({ query: doc.name, start: t.start, end: t.end, line: t.line, col: t.col, text: (lines[t.line - 1] || '').trim() });
    }
  }
  return out;
}
