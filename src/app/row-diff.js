import { splitSheetOutput } from '../batch/execute/changes.js';

const pathOf = (row) => `${row.folder}${row.file}`;
const keyOf = (op, oldHash, newHash) => `${op}|${oldHash || ''}|${newHash || ''}`;

function transformDetail(row, path, combined) {
  const split = splitSheetOutput(row.output);
  const base = { file: path, target: { name: row.unit }, op: 'transform' };
  if (!split) return { ...base, writes: `${row.folder}${row.output}` };
  return combined ? { ...base, writes: split.file, sheet: split.sheet, kind: 'combined' } : { ...base, writes: `${row.folder}${split.file}`, sheet: split.sheet };
}

export function rowDiff(result, index) {
  const row = result.rows[index];
  if (!row || row.verdict !== 'changed') return null;
  const path = pathOf(row);
  const ix = result.indexes.find((i) => i.relPath === path);
  const held = ix && result.perFile.get(ix.id);
  if (!held) return null;
  if (row.action === 'transform') return row.output ? transformDetail(row, path, !!result.plan && result.plan.recipe.output.mode === 'combined') : null;
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
