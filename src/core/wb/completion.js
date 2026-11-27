import { KEYWORDS, lex } from '../m/lexer.js';
import { rank } from './fuzzy.js';
import { quoteIdent } from './ident.js';

const KEYWORDS_OFFERED = ['each', 'let', 'in', 'if', 'then', 'else', 'try', 'otherwise'];
const MAX_ITEMS = 60;
const WIDE_LIMIT = 12;
const OPEN = new Set(['(', '[', '{']);
const CLOSE = new Set([')', ']', '}']);
const WORD_END = /(^|[^\p{L}\p{Nd}\p{Mn}\p{Mc}\p{Pc}.])([\p{L}_][\p{L}\p{Nd}\p{Mn}\p{Mc}\p{Pc}.]*)$/u;
const WORD_AFTER = /^[\p{L}\p{Nd}\p{Mn}\p{Mc}\p{Pc}][\p{L}\p{Nd}\p{Mn}\p{Mc}\p{Pc}.]*/u;
const NOT_A_NAME = /([\p{L}\p{Nd}\p{Mn}\p{Mc}\p{Pc}]|[\p{Nd}]\.)$/u;
const NAME_BEFORE_HASH = /([\p{L}\p{Nd}\p{Mn}\p{Mc}\p{Pc}]|")$/u;
const QUOTED_START = /#"([^"]*)$/;
const HASH_END = /#([a-z]*)$/i;
const byName = new WeakMap();
const isName = (t) => t.kind === 'ident' || t.kind === 'qident';
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

function alphabetical(library) {
  let sorted = byName.get(library);
  if (!sorted) {
    sorted = [...library].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    byName.set(library, sorted);
  }
  return sorted;
}

function before(tokens, i) {
  for (let j = i - 1; j >= 0; j--) if (tokens[j].kind !== 'comment') return tokens[j];
  return null;
}

function isAccess(tokens, i) {
  const prev = before(tokens, i);
  if (!prev) return false;
  if (isName(prev) || prev.kind === 'number' || prev.kind === 'string') return true;
  if (prev.kind === 'keyword' && prev.value[0] === '#') return true;
  return prev.kind === 'op' && (prev.value === ')' || prev.value === '}' || prev.value === ']');
}

function bracketAt(tokens, i) {
  const access = isAccess(tokens, i);
  const prev = access ? before(tokens, i) : null;
  return { access, head: prev && isName(prev) ? prev.value : null };
}

export function analyze(text, offset) {
  const tokens = lex(text).filter((t) => t.kind !== 'ws');
  const lets = [{ depth: 0, last: null, limit: null, id: 0, inBody: false }];
  const brackets = [];
  let depth = 0;
  let seq = 0;
  let blocked = false;
  let snap = null;
  const bindings = [];
  const closeTop = (at) => {
    const frame = lets[lets.length - 1];
    if (frame.limit === null) frame.limit = at;
    if (!frame.last) return;
    if (frame.last.exprEnd === null) frame.last.exprEnd = at;
    if (frame.last.limit === null) frame.last.limit = at;
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (snap === null && t.start >= offset) snap = { frames: lets.map((f) => f.id), bracket: brackets[brackets.length - 1] || null };
    if (t.kind === 'comment') {
      if (t.start < offset && offset <= t.end) blocked = true;
      continue;
    }
    if (t.kind === 'string') {
      if (t.start < offset && (offset < t.end || t.unterminated)) blocked = true;
      continue;
    }
    if (t.kind === 'error') {
      if (t.unterminated && t.unterminated !== 'identifier' && t.start < offset) blocked = true;
      continue;
    }
    if (t.kind === 'qident' && t.start < offset && offset < t.end) blocked = true;
    if (t.kind === 'op') {
      if (OPEN.has(t.value)) {
        depth++;
        if (t.value === '[') brackets.push(bracketAt(tokens, i));
      } else if (CLOSE.has(t.value)) {
        depth = Math.max(0, depth - 1);
        if (t.value === ']') brackets.pop();
        while (lets.length > 1 && lets[lets.length - 1].depth > depth) {
          closeTop(t.start);
          lets.pop();
        }
      } else if (t.value === ',') {
        let frame = lets[lets.length - 1];
        if (frame.inBody && frame.depth === depth && lets.length > 1) {
          closeTop(t.start);
          lets.pop();
          frame = lets[lets.length - 1];
        }
        if (frame.last && frame.last.exprEnd === null && depth === frame.depth) frame.last.exprEnd = t.start;
      }
      continue;
    }
    if (t.kind === 'keyword') {
      if (t.value === 'let') lets.push({ depth, last: null, limit: null, id: ++seq, inBody: false });
      else if (t.value === 'in') {
        while (lets.length > 1 && lets[lets.length - 1].inBody) {
          closeTop(t.start);
          lets.pop();
        }
        closeTop(t.start);
        lets[lets.length - 1].inBody = true;
      }
      continue;
    }
    const next = tokens[i + 1];
    const frame = lets[lets.length - 1];
    if (!isName(t) || !next || next.kind !== 'op' || next.value !== '=' || frame.inBody || depth !== frame.depth) continue;
    const binding = { name: t.value, start: t.start, nameEnd: t.end, exprStart: next.end, exprEnd: null, limit: null, frameId: frame.id, ancestors: lets.slice(0, -1).map((f) => f.id) };
    closeTop(t.start);
    frame.last = binding;
    bindings.push(binding);
  }
  if (snap === null) snap = { frames: lets.map((f) => f.id), bracket: brackets[brackets.length - 1] || null };
  while (lets.length) {
    closeTop(text.length);
    lets.pop();
  }
  return { tokens, bindings, blocked, frames: snap.frames, bracket: snap.bracket };
}

function columnsOf(columns, name) {
  if (!columns || !name) return null;
  const entries = columns instanceof Map ? [...columns] : Object.entries(columns);
  for (const [k, v] of entries) if (same(k, name)) return v;
  return null;
}

function inputStepOf(binding, bindings, tokens) {
  const earlier = bindings.filter((o) => o !== binding && (binding.ancestors.includes(o.frameId) || (o.frameId === binding.frameId && o.exprEnd !== null && o.exprEnd <= binding.start)));
  const names = new Map(earlier.map((o) => [o.name.toLowerCase(), o.name]));
  const exprEnd = binding.exprEnd === null ? binding.limit || Infinity : binding.exprEnd;
  for (const t of tokens) {
    if (t.start < binding.exprStart) continue;
    if (t.start >= exprEnd) break;
    if (isName(t) && names.has(t.value.toLowerCase())) return names.get(t.value.toLowerCase());
  }
  const siblings = earlier.filter((o) => o.frameId === binding.frameId);
  return siblings.length ? siblings[siblings.length - 1].name : null;
}

function signatureOf(entry) {
  if (!entry.params) return '';
  const names = entry.params.map((p) => (entry.optional && entry.optional.includes(p) ? `${p}?` : p));
  if (entry.variadic) names.push('…');
  return `(${names.join(', ')})`;
}

const libraryItem = (e, ranges) => ({ label: e.name, insert: e.name, kind: 'library', libraryKind: e.kind, status: e.status || 'full', detail: signatureOf(e), ranges });
const nameItem = (kind, insertOf) => (r) => ({ label: r.item, insert: insertOf(r.item), kind, detail: '', ranges: r.ranges });
const stepItem = (r) => ({ label: r.item.name, insert: quoteIdent(r.item.name), kind: 'step', detail: '', ranges: r.ranges });

function merge(tiers, query) {
  const rows = [];
  for (const [tier, ranked, make] of tiers) for (const r of ranked) rows.push({ tier, score: Math.floor(r.score / 2), length: r.length, index: r.index, item: make(r) });
  const byQuery = (a, b) => b.score - a.score || a.tier - b.tier || a.length - b.length || a.index - b.index;
  const byTier = (a, b) => a.tier - b.tier || a.index - b.index;
  rows.sort(query ? byQuery : byTier);
  const items = [];
  const seen = new Set();
  for (const row of rows) {
    const key = row.item.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(row.item);
  }
  return items.slice(0, MAX_ITEMS);
}

function libraryAfterDot(head, tail, library) {
  const width = head.length + 1;
  const entries = alphabetical(library).filter((e) => same(e.category, head));
  return rank(tail, entries, (e) => e.name.slice(width)).map((r) => {
    const item = libraryItem(r.item, r.ranges.map(([a, b]) => [a + width, b + width]));
    return { ...item, insert: r.item.name.slice(width) };
  });
}

function literalItems(query) {
  return [...KEYWORDS].filter((k) => k[0] === '#' && k.slice(1).toLowerCase().startsWith(query)).map((k) => ({ label: k, insert: k, kind: 'literal', detail: '', ranges: [] }));
}

export function completionAt(text, offset, ctx = {}) {
  if (offset < 0 || offset > text.length) return null;
  const lineStart = Math.max(text.lastIndexOf('\n', offset - 1), text.lastIndexOf('\r', offset - 1)) + 1;
  const beforeText = text.slice(lineStart, offset);
  const library = Array.isArray(ctx.library) ? ctx.library : [];
  const { tokens, bindings, blocked, frames, bracket } = analyze(text, offset);
  if (blocked) return null;
  const inner = frames[frames.length - 1];
  const scope = bindings.filter((b) => frames.includes(b.frameId) && (b.frameId !== inner ? b.start < offset : b.exprEnd !== null && b.exprEnd <= offset));
  const queriesOf = (names) => [...new Set(names.filter((n) => !same(n, ctx.self) && !scope.some((b) => same(b.name, n))))];
  const quoted = QUOTED_START.exec(beforeText);
  if (quoted) {
    const quotedName = (n) => `#"${n.replace(/"/g, '""')}"`;
    const items = [
      ...rank(quoted[1], scope, (b) => b.name).map(stepItem),
      ...rank(quoted[1], queriesOf(ctx.queries || []), (n) => n).map(nameItem('query', quotedName))
    ].map((it) => ({ ...it, insert: quotedName(it.label) })).slice(0, MAX_ITEMS);
    return items.length ? { start: lineStart + quoted.index, end: offset, auto: quoted[1].length > 0, mode: 'quoted', items } : null;
  }
  const hash = HASH_END.exec(beforeText);
  if (hash) {
    if (NAME_BEFORE_HASH.test(beforeText.slice(0, hash.index))) return null;
    const query = hash[1].toLowerCase();
    return { start: lineStart + hash.index, end: offset, auto: query.length > 0, mode: 'literal', items: literalItems(query) };
  }
  const wordMatch = WORD_END.exec(beforeText);
  const word = wordMatch ? wordMatch[2] : '';
  if (!word && NOT_A_NAME.test(beforeText)) return null;
  const after = WORD_AFTER.exec(text.slice(offset)) || [''];
  const start = offset - word.length;
  const end = offset + after[0].length;
  const dot = word.lastIndexOf('.');
  if (dot >= 0) {
    const items = libraryAfterDot(word.slice(0, dot), word.slice(dot + 1).toLowerCase(), library);
    return items.length ? { start: offset - (word.length - dot - 1), end, auto: true, mode: 'library', items: items.slice(0, MAX_ITEMS) } : null;
  }
  const query = word.toLowerCase();
  const current = bindings.filter((b) => b.start <= offset && offset <= (b.limit === null ? text.length : b.limit)).pop() || null;
  if (current && offset <= current.nameEnd) return null;
  const inScope = scope.filter((b) => b !== current);
  const limit = query ? Infinity : WIDE_LIMIT;
  const columnRows = (source) => rank(query, columnsOf(ctx.columns, source) || [], (c) => c, limit);
  const lastStep = inScope.length ? inScope[inScope.length - 1].name : null;
  const stepRows = () => rank(query, inScope, (b) => b.name, limit);
  const queryRows = () => rank(query, queriesOf(ctx.queries || []), (n) => n, limit);
  let items;
  if (bracket && bracket.access) {
    items = merge([[0, columnRows(bracket.head), nameItem('column', quoteIdent)]], query);
  } else if (bracket) {
    items = merge([
      [0, columnRows(current ? inputStepOf(current, bindings, tokens) : lastStep), nameItem('column', quoteIdent)],
      [1, stepRows(), stepItem],
      [2, queryRows(), nameItem('query', quoteIdent)]
    ], query);
  } else {
    items = merge([
      [0, stepRows(), stepItem],
      [1, queryRows(), nameItem('query', quoteIdent)],
      [2, rank(query, KEYWORDS_OFFERED, (k) => k, limit), nameItem('keyword', (k) => k)],
      [3, rank(query, alphabetical(library), (e) => e.name, limit), (r) => libraryItem(r.item, r.ranges)]
    ], query);
  }
  if (!items.length) return null;
  const auto = word.length >= 2;
  return { start, end, auto, mode: bracket ? 'record' : 'names', items };
}
