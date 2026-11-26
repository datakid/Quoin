import { rank } from './fuzzy.js';

export const CHIPS = ['edited', 'errors', 'stale', 'never', 'loaded', 'connection', 'functions', 'macro'];
export const GROUPS = ['none', 'folder', 'load', 'status', 'layer'];
export const SORTS = ['section', 'name', 'lastRun', 'duration', 'rows'];

const CHIP_TEST = {
  edited: (i) => !!i.edited,
  errors: (i) => i.status === 'error',
  stale: (i) => i.status === 'stale',
  never: (i) => i.status === 'never',
  loaded: (i) => !i.isFunction && !!i.load && i.load.kind === 'table',
  connection: (i) => !i.isFunction && !!i.load && i.load.kind !== 'table',
  functions: (i) => !!i.isFunction,
  macro: (i) => !!i.linkedToMacro
};

export function layerOf(item) {
  if (item.refs === undefined) return 'staging';
  if (item.refs === 0) return 'sources';
  return item.usedBy === 0 ? 'outputs' : 'staging';
}

const STATUS_ORDER = ['error', 'stale', 'running', 'queued', 'stopped', 'cancelled', 'never', 'ok', 'skipped'];

function groupKeyOf(item, group) {
  if (group === 'folder') return item.folder || '';
  if (group === 'load') return item.isFunction ? 'function' : item.load && item.load.kind === 'table' ? 'table' : 'connection';
  if (group === 'status') return item.status || 'never';
  if (group === 'layer') return layerOf(item);
  return '';
}

function groupOrder(group, keys) {
  if (group === 'status') return [...keys].sort((a, b) => STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b));
  if (group === 'layer') return ['sources', 'staging', 'outputs'].filter((k) => keys.has(k));
  if (group === 'load') return ['table', 'connection', 'function'].filter((k) => keys.has(k));
  return [...keys].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
}

function sorter(sort) {
  if (sort === 'name') return (a, b) => a.name.localeCompare(b.name) || a.index - b.index;
  if (sort === 'lastRun') return (a, b) => (b.lastRunAt || 0) - (a.lastRunAt || 0) || a.index - b.index;
  if (sort === 'duration') return (a, b) => (b.durationMs || 0) - (a.durationMs || 0) || a.index - b.index;
  if (sort === 'rows') return (a, b) => (b.rows === null || b.rows === undefined ? -1 : b.rows) - (a.rows === null || a.rows === undefined ? -1 : a.rows) || a.index - b.index;
  return (a, b) => a.index - b.index;
}

export function parseSearch(raw) {
  const t = raw.trim();
  if (/^code:/i.test(t)) return { mode: 'code', query: t.slice(5).trim() };
  if (/^step:/i.test(t)) return { mode: 'step', query: t.slice(5).trim() };
  return { mode: 'name', query: t };
}

function countOccurrences(text, needle) {
  if (!needle) return 0;
  const hay = text.toLowerCase();
  const n = needle.toLowerCase();
  let at = 0;
  let c = 0;
  for (;;) {
    const i = hay.indexOf(n, at);
    if (i < 0) return c;
    c++;
    at = i + n.length;
  }
}

export function searchItems(items, raw) {
  const { mode, query } = parseSearch(raw);
  if (!query) return null;
  if (mode === 'code') {
    const out = [];
    for (const it of items) {
      const c = countOccurrences(it.text || '', query);
      if (c) out.push({ item: it, ranges: [], matches: c });
    }
    return out;
  }
  if (mode === 'step') {
    const out = [];
    for (const it of items) {
      const c = (it.steps || []).filter((s) => rank(query, [s], (x) => x).length).length;
      if (c) out.push({ item: it, ranges: [], matches: c });
    }
    return out;
  }
  return rank(query, items, (i) => i.name).map((r) => ({ item: r.item, ranges: r.ranges, matches: 0 }));
}

export function chipCounts(items, search) {
  const base = search ? searchItems(items, search).map((r) => r.item) : items;
  return Object.fromEntries(CHIPS.map((c) => [c, base.filter(CHIP_TEST[c]).length]));
}

function statusCounts(list) {
  const c = {};
  for (const i of list) c[i.status || 'never'] = (c[i.status || 'never'] || 0) + 1;
  return c;
}

export function buildRows(items, { group = 'none', sort = 'section', filters = new Set(), search = '', collapsed = new Set() } = {}) {
  let found = null;
  let pool = items;
  if (search && search.trim()) {
    found = searchItems(pool, search);
    if (found) pool = found.map((r) => r.item);
  }
  const active = [...filters].filter((f) => CHIP_TEST[f]);
  if (active.length) pool = pool.filter((i) => active.every((f) => CHIP_TEST[f](i)));
  const meta = new Map((found || []).map((r) => [r.item, r]));
  const row = (item) => ({ kind: 'item', key: `${item.type || 'query'}:${item.name}`, item, ranges: meta.has(item) ? meta.get(item).ranges : [], matches: meta.has(item) ? meta.get(item).matches : 0 });
  if (found) {
    const rows = found.map((r) => r.item).filter((i) => pool.includes(i)).map(row);
    return { rows, total: pool.length };
  }
  const sorted = pool.slice().sort(sorter(sort));
  if (group === 'none') return { rows: sorted.map(row), total: sorted.length };
  const buckets = new Map();
  for (const i of sorted) {
    const k = groupKeyOf(i, group);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(i);
  }
  const rows = [];
  for (const k of groupOrder(group, new Set(buckets.keys()))) {
    const list = buckets.get(k);
    const isCollapsed = collapsed.has(k);
    rows.push({ kind: 'group', key: `group:${k}`, group: k, count: list.length, statuses: statusCounts(list), collapsed: isCollapsed });
    if (!isCollapsed) for (const i of list) rows.push(row(i));
  }
  return { rows, total: sorted.length };
}

export function windowOf(count, scrollTop, viewport, rowH, overscan = 6) {
  const first = Math.max(0, Math.floor(scrollTop / rowH) - overscan);
  const last = Math.min(count, Math.ceil((scrollTop + viewport) / rowH) + overscan);
  return { start: first, end: Math.max(first, last), top: first * rowH, total: count * rowH };
}

export class Selection {
  constructor() {
    this.keys = new Set();
    this.anchor = null;
  }

  click(keys, key, { shift = false, ctrl = false } = {}) {
    if (shift && this.anchor !== null && keys.includes(this.anchor)) {
      const a = keys.indexOf(this.anchor);
      const b = keys.indexOf(key);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      this.keys = new Set(ctrl ? [...this.keys, ...keys.slice(lo, hi + 1)] : keys.slice(lo, hi + 1));
    } else if (ctrl) {
      if (this.keys.has(key)) this.keys.delete(key);
      else this.keys.add(key);
      this.anchor = key;
    } else {
      this.keys = new Set([key]);
      this.anchor = key;
    }
    return this.keys;
  }

  toggle(key) {
    if (this.keys.has(key)) this.keys.delete(key);
    else this.keys.add(key);
    this.anchor = key;
    return this.keys;
  }

  extend(keys, from, delta) {
    const at = keys.indexOf(from);
    const to = Math.max(0, Math.min(keys.length - 1, at + delta));
    if (this.anchor === null || !keys.includes(this.anchor)) this.anchor = from;
    const a = keys.indexOf(this.anchor);
    const [lo, hi] = a < to ? [a, to] : [to, a];
    this.keys = new Set(keys.slice(lo, hi + 1));
    return keys[to];
  }

  selectAll(keys) {
    this.keys = new Set(keys);
    return this.keys;
  }

  prune(valid) {
    const v = new Set(valid);
    for (const k of [...this.keys]) if (!v.has(k)) this.keys.delete(k);
    if (this.anchor !== null && !v.has(this.anchor)) this.anchor = null;
  }

  clear() {
    this.keys = new Set();
    this.anchor = null;
  }
}
