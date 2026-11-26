export function schemaDiff(a, b) {
  const byName = (cols) => new Map(cols.map((c) => [c.name, c]));
  const A = byName(a);
  const B = byName(b);
  const added = b.filter((c) => !A.has(c.name)).map((c) => c.name);
  const removed = a.filter((c) => !B.has(c.name)).map((c) => c.name);
  const retyped = [];
  for (const [name, col] of A) {
    const other = B.get(name);
    if (other && (other.type || 'any') !== (col.type || 'any')) retyped.push({ name, from: col.type || 'any', to: other.type || 'any' });
  }
  return { added, removed, retyped, same: !added.length && !removed.length && !retyped.length };
}

export function rowDelta(a, b) {
  return { a, b, delta: b - a };
}

export function cellKey(v) {
  if (v === null || v === undefined) return 'n:';
  if (typeof v === 'object') return `o:${JSON.stringify(v)}`;
  return `${typeof v === 'number' ? 'd' : typeof v === 'boolean' ? 'b' : 's'}:${String(v)}`;
}

export function diffCells(rowsA, rowsB, limit = 200) {
  const out = [];
  const n = Math.min(rowsA.length, rowsB.length);
  let total = 0;
  for (let r = 0; r < n; r++) {
    const ra = rowsA[r] || [];
    const rb = rowsB[r] || [];
    const m = Math.min(ra.length, rb.length);
    for (let c = 0; c < m; c++) {
      if (cellKey(ra[c]) === cellKey(rb[c])) continue;
      total++;
      if (out.length < limit) out.push({ row: r, col: c, a: ra[c], b: rb[c] });
    }
  }
  return { cells: out, total, scanned: n, capped: total > out.length };
}
