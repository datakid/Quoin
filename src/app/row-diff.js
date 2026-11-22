const pathOf = (row) => `${row.folder}${row.file}`;
const keyOf = (op, oldHash, newHash) => `${op}|${oldHash || ''}|${newHash || ''}`;

export function rowDiff(result, index) {
  const row = result.rows[index];
  if (!row || row.verdict !== 'changed') return null;
  const path = pathOf(row);
  const ix = result.indexes.find((i) => i.relPath === path);
  const held = ix && result.perFile.get(ix.id);
  if (!held) return null;
  const rowKey = keyOf(row.action, row.old_hash, row.new_hash);
  let nth = 0;
  for (let i = 0; i < index; i++) {
    const r = result.rows[i];
    if (r.verdict === 'changed' && pathOf(r) === path && keyOf(r.action, r.old_hash, r.new_hash) === rowKey) nth++;
  }
  const change = held.changes.filter((c) => keyOf(c.op, c.oldHash, c.newHash) === rowKey)[nth];
  if (!change) return null;
  const base = { file: path, target: change.target, op: change.op };
  if (change.op === 'rename') return { ...base, rename: { from: change.target.name, to: change.newName } };
  if (!change.texts) return null;
  return { ...base, before: change.texts.before, after: change.texts.after };
}
