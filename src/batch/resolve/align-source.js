const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function alignSourceFor(align, indexes) {
  const ordered = indexes.filter((ix) => ix.status === 'ready').sort((a, b) => compare(a.relPath, b.relPath) || compare(a.id, b.id));
  for (const ix of ordered) {
    const found = (align.target === 'module' ? ix.modules : ix.queries).find((m) => m.name === align.name && m.hash === align.hash);
    if (found) return { fileId: ix.id, relPath: ix.relPath, name: found.name };
  }
  return null;
}
