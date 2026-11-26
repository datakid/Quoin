import { lex } from '../m/lexer.js';

export const MAX_MATCHES = 20000;
export const CHUNK_MS = 50;

const WORD = /[\p{L}\p{N}_]/u;

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildRegex(query, { matchCase = false, wholeWord = false, regex = false } = {}) {
  if (!query) return { error: null, re: null };
  let source = regex ? query : escapeRegex(query);
  if (wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  try {
    return { error: null, re: new RegExp(source, `gu${matchCase ? '' : 'i'}`) };
  } catch (e) {
    return { error: e.message, re: null };
  }
}

function mCodeMask(text) {
  const mask = new Uint8Array(text.length).fill(1);
  for (const t of lex(text)) {
    if (t.kind === 'comment' || t.kind === 'string') for (let i = t.start; i < t.end; i++) mask[i] = 0;
  }
  return mask;
}

function vbaCodeMask(text) {
  const mask = new Uint8Array(text.length).fill(1);
  let i = 0;
  let lineStart = true;
  while (i < text.length) {
    const c = text[i];
    if (c === '\n' || c === '\r') {
      lineStart = true;
      i++;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '\n' && text[j] !== '\r') {
        if (text[j] === '"') {
          if (text[j + 1] === '"') {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      for (let k = i; k < j; k++) mask[k] = 0;
      i = j;
      lineStart = false;
      continue;
    }
    const isComment = c === "'" || (/^[Rr][Ee][Mm](?=[\s]|$)/.test(text.slice(i, i + 4)) && (lineStart || /(?:^|[:\s])$/.test(text.slice(Math.max(0, i - 1), i))) && (lineStart || text[i - 1] === ':'));
    if (isComment) {
      let j = i;
      while (j < text.length && text[j] !== '\n' && text[j] !== '\r') j++;
      for (let k = i; k < j; k++) mask[k] = 0;
      i = j;
      continue;
    }
    if (c !== ' ' && c !== '\t') lineStart = false;
    i++;
  }
  return mask;
}

export function codeMask(text, language) {
  return language === 'vba' ? vbaCodeMask(text) : mCodeMask(text);
}

function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\r' && text[i + 1] === '\n') {
      i++;
      starts.push(i + 1);
    } else if (text[i] === '\n' || text[i] === '\r') starts.push(i + 1);
  }
  return starts;
}

function locate(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function lineText(text, starts, line) {
  const s = starts[line];
  let e = line + 1 < starts.length ? starts[line + 1] : text.length;
  while (e > s && (text[e - 1] === '\n' || text[e - 1] === '\r')) e--;
  return text.slice(s, e);
}

export function* searchText(text, opts, { budgetMs = CHUNK_MS, cap = MAX_MATCHES, now = () => performance.now() } = {}) {
  const { error, re } = buildRegex(opts.query, opts);
  if (error) {
    yield { done: true, error, matches: [] };
    return;
  }
  if (!re) {
    yield { done: true, error: null, matches: [] };
    return;
  }
  const mask = opts.codeOnly ? codeMask(text, opts.language || 'm') : null;
  const starts = lineIndex(text);
  const matches = [];
  let t0 = now();
  let capped = false;
  re.lastIndex = 0;
  for (;;) {
    const m = re.exec(text);
    if (!m) break;
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const start = m.index;
    const end = start + m[0].length;
    if (mask) {
      let inCode = true;
      for (let i = start; i < end; i++) {
        if (!mask[i]) {
          inCode = false;
          break;
        }
      }
      if (!inCode) continue;
    }
    const line = locate(starts, start);
    matches.push({ start, end, line: line + 1, col: start - starts[line] + 1, text: m[0], groups: m.slice(1), preview: lineText(text, starts, line) });
    if (matches.length >= cap) {
      capped = true;
      break;
    }
    if (now() - t0 > budgetMs) {
      yield { done: false, matches: matches.slice() };
      t0 = now();
    }
  }
  yield { done: true, error: null, matches, capped };
}

export function searchAll(text, opts, config) {
  let last = null;
  for (const step of searchText(text, opts, config)) last = step;
  return last;
}

export function expandReplacement(template, match, regex) {
  if (!regex) return template;
  return template.replace(/\$(\$|&|\d{1,2})/g, (all, g) => {
    if (g === '$') return '$';
    if (g === '&') return match.text;
    const n = Number(g);
    return n >= 1 && n <= match.groups.length && match.groups[n - 1] !== undefined ? match.groups[n - 1] : all;
  });
}

export function applyReplacements(text, matches, template, { regex = false } = {}) {
  const ordered = matches.slice().sort((a, b) => b.start - a.start);
  let out = text;
  for (const m of ordered) out = out.slice(0, m.start) + expandReplacement(template, m, regex) + out.slice(m.end);
  return out;
}

export function previewReplacement(match, template, { regex = false } = {}) {
  const replaced = expandReplacement(template, match, regex);
  const col = match.col - 1;
  return { before: match.preview, after: match.preview.slice(0, col) + replaced + match.preview.slice(col + match.text.length) };
}

export function findInItems(items, opts, config) {
  const out = [];
  let total = 0;
  for (const it of items) {
    if (opts.scope === 'queries' && it.type !== 'query') continue;
    if (opts.scope === 'modules' && it.type !== 'module') continue;
    if (opts.scope === 'current' && !it.current) continue;
    if (opts.scope === 'selection' && !it.selected) continue;
    const r = searchAll(it.text, { ...opts, language: it.type === 'module' ? 'vba' : 'm' }, { ...config, cap: Math.max(0, MAX_MATCHES - total) });
    if (r.error) return { error: r.error, results: [], total: 0 };
    if (!r.matches.length) continue;
    total += r.matches.length;
    out.push({ item: { type: it.type, name: it.name }, skipped: it.readOnly || null, matches: r.matches });
    if (total >= MAX_MATCHES) break;
  }
  return { error: null, results: out, total, capped: total >= MAX_MATCHES };
}

export async function findInItemsAsync(items, opts, { yieldFn = () => Promise.resolve(), isCancelled = () => false, budgetMs = CHUNK_MS, now = () => performance.now() } = {}) {
  const out = [];
  let total = 0;
  let capped = false;
  for (const it of items) {
    if (isCancelled()) return { cancelled: true, error: null, results: out, total, capped };
    if (opts.scope === 'queries' && it.type !== 'query') continue;
    if (opts.scope === 'modules' && it.type !== 'module') continue;
    if (opts.scope === 'current' && !it.current) continue;
    let matches = [];
    for (const step of searchText(it.text, { ...opts, language: it.type === 'module' ? 'vba' : 'm' }, { budgetMs, cap: Math.max(0, MAX_MATCHES - total), now })) {
      if (step.error) return { cancelled: false, error: step.error, results: [], total: 0, capped: false };
      matches = step.matches;
      if (!step.done) {
        await yieldFn();
        if (isCancelled()) return { cancelled: true, error: null, results: out, total, capped };
      }
    }
    if (!matches.length) continue;
    total += matches.length;
    out.push({ item: { type: it.type, name: it.name }, skipped: it.readOnly || null, matches });
    if (total >= MAX_MATCHES) {
      capped = true;
      break;
    }
    await yieldFn();
  }
  return { cancelled: false, error: null, results: out, total, capped };
}
