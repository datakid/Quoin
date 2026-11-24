export function shapeOf(result) {
  if (!result || !result.kind) return null;
  if (result.kind === 'table' && result.value && Array.isArray(result.value.columns)) {
    return { kind: 'table', rows: result.value.rowCount, columns: result.value.columns.map((c) => ({ name: c.name, type: c.type || 'any' })) };
  }
  if (result.kind === 'list' && result.value) return { kind: 'list', count: result.value.count };
  return { kind: result.kind };
}

export function rowsCountable(n, { countRows = true, limit = 2000000 } = {}) {
  return !!countRows && Number.isFinite(n) && n <= limit;
}

export function schemaChange(prev, cur) {
  const prevNames = new Set(prev.map((c) => c.name));
  const curNames = new Set(cur.map((c) => c.name));
  const added = cur.filter((c) => !prevNames.has(c.name));
  const removed = prev.filter((c) => !curNames.has(c.name));
  let renamed = 0;
  const limit = Math.min(prev.length, cur.length);
  for (let i = 0; i < limit; i++) if (!prevNames.has(cur[i].name) && !curNames.has(prev[i].name)) renamed++;
  const before = new Map(prev.map((c) => [c.name, c.type]));
  let types = 0;
  for (const c of cur) if (before.has(c.name) && before.get(c.name) !== c.type) types++;
  return { added: added.length - renamed, removed: removed.length - renamed, renamed, types };
}

export function stepDelta(prev, cur) {
  if (!cur) return null;
  if (cur.kind !== 'table') return { type: 'kind', kind: cur.kind, count: cur.count };
  if (!prev || prev.kind !== 'table') return { type: 'rows', rows: cur.rows };
  const parts = [];
  if (cur.rows !== null && prev.rows !== null && cur.rows !== prev.rows) parts.push({ k: 'rows', n: cur.rows - prev.rows });
  const c = schemaChange(prev.columns, cur.columns);
  if (c.added > 0) parts.push({ k: 'added', n: c.added });
  if (c.removed > 0) parts.push({ k: 'removed', n: c.removed });
  if (c.renamed > 0) parts.push({ k: 'renamed', n: c.renamed });
  if (c.types > 0) parts.push({ k: 'types', n: c.types });
  return parts.length ? { type: 'parts', parts } : { type: 'same' };
}
