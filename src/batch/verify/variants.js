const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const KIND_RANK = { query: 0, module: 1 };

export const variantKey = (item) => `${item.kind}:${item.name}`;

export function groupVariants(indexes) {
  const byKey = new Map();
  const add = (kind, name, hash, ix) => {
    const key = `${kind}:${name}`;
    if (!byKey.has(key)) byKey.set(key, { kind, name, byHash: new Map() });
    const entry = byKey.get(key);
    if (!entry.byHash.has(hash)) entry.byHash.set(hash, []);
    entry.byHash.get(hash).push({ fileId: ix.id, relPath: ix.relPath });
  };
  for (const ix of indexes) {
    if (ix.status !== 'ready') continue;
    for (const q of ix.queries) add('query', q.name, q.hash, ix);
    for (const m of ix.modules) add('module', m.name, m.hash, ix);
  }
  const items = [...byKey.values()].map((entry) => {
    const versions = [...entry.byHash.entries()]
      .map(([hash, files]) => ({ hash, count: files.length, files: files.sort((a, b) => compare(a.relPath, b.relPath) || compare(a.fileId, b.fileId)) }))
      .sort((a, b) => b.count - a.count || compare(a.hash, b.hash));
    return { kind: entry.kind, name: entry.name, files: versions.reduce((n, v) => n + v.count, 0), versions, mostCommon: versions[0].hash, drift: versions.length > 1 };
  });
  items.sort((a, b) => b.versions.length - a.versions.length || compare(a.name, b.name) || KIND_RANK[a.kind] - KIND_RANK[b.kind]);
  return { items, drifted: items.filter((i) => i.drift).length };
}
