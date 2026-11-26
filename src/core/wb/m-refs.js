import { lex } from '../m/lexer.js';
import { analyze } from './completion.js';

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

export function nameAt(text, offset) {
  if (offset < 0 || offset > text.length) return null;
  const tokens = lex(text).filter((t) => t.kind === 'ident' || t.kind === 'qident');
  for (const t of tokens) {
    if (t.start <= offset && offset <= t.end) return { name: t.value, start: t.start, end: t.end };
  }
  return null;
}

export function lineColAt(text, at) {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < at; i++) {
    if (text.charCodeAt(i) === 0x0D) {
      if (text.charCodeAt(i + 1) === 0x0A) i++;
      line++;
      lineStart = i + 1;
    } else if (text.charCodeAt(i) === 0x0A) {
      line++;
      lineStart = i + 1;
    }
  }
  const end = text.indexOf('\n', lineStart);
  const raw = text.slice(lineStart, end < 0 ? text.length : end).replace(/\r$/, '');
  return { line, col: at - lineStart + 1, excerpt: raw.trim() };
}

export function referencesOf(queries, name) {
  const rows = [];
  for (const q of queries) {
    const tokens = lex(q.text).filter((t) => t.kind === 'ident' || t.kind === 'qident');
    const { bindings } = analyze(q.text, q.text.length);
    for (const t of tokens) {
      if (!same(t.value, name)) continue;
      const place = lineColAt(q.text, t.start);
      const defined = bindings.some((b) => same(b.name, name) && b.start === t.start);
      rows.push({ item: q.name, start: t.start, end: t.end, kind: defined ? 'definition' : 'reference', line: place.line, col: place.col, excerpt: place.excerpt });
    }
  }
  return rows;
}

export function resolveNameAt(text, offset, ctx = {}) {
  const found = nameAt(text, offset);
  if (!found) return null;
  const lower = found.name.toLowerCase();
  const { bindings } = analyze(text, text.length);
  const at = analyze(text, found.start);
  const inScope = bindings.filter((b) => same(b.name, found.name) && at.frames.includes(b.frameId) && (b.frameId !== at.frames[at.frames.length - 1] || (b.exprEnd !== null && b.exprEnd <= found.start)));
  const binding = inScope.length ? inScope[inScope.length - 1] : bindings.filter((b) => same(b.name, found.name)).pop() || null;
  if (binding) {
    const topLevel = bindings.filter((b) => b.frameId === 1);
    return { ...found, kind: 'step', binding: { start: binding.start, nameEnd: binding.nameEnd, index: topLevel.indexOf(binding), topLevel: binding.frameId === 1 } };
  }
  if ((ctx.queries || []).some((q) => same(q, found.name))) return { ...found, kind: 'query' };
  const library = (ctx.library || []).find((e) => same(e.name, found.name));
  if (library) return { ...found, kind: 'library', library };
  return { ...found, kind: 'unknown' };
}

export function signatureAt(text, offset, library) {
  const tokens = lex(text).filter((t) => t.kind !== 'ws' && t.kind !== 'comment');
  const stack = [];
  for (const t of tokens) {
    if (t.start >= offset) break;
    if (t.kind !== 'op') continue;
    if (t.value === '(') stack.push({ at: t.start, commas: 0 });
    else if (t.value === ')') stack.pop();
    else if (t.value === ',' && stack.length) stack[stack.length - 1].commas++;
  }
  const call = stack[stack.length - 1];
  if (!call) return null;
  const i = tokens.findIndex((t) => t.start === call.at);
  const callee = i > 0 ? tokens[i - 1] : null;
  if (!callee || (callee.kind !== 'ident' && callee.kind !== 'qident' && !(callee.kind === 'keyword' && callee.value[0] === '#'))) return null;
  const entry = (library || []).find((e) => same(e.name, callee.value));
  if (!entry || entry.kind !== 'function') return null;
  return { name: entry.name, entry, current: call.commas };
}
