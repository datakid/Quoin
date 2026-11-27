import { QuoinError } from '../errors.js';
import { normalizeQueryText } from './section.js';

export function changedQueryEdits(wb, edits) {
  const out = new Map();
  for (const [name, view] of edits) {
    const q = wb.queries.find((x) => x.name === name);
    if (!q) throw new QuoinError('pq.unknown', name);
    const trimmed = normalizeQueryText(view);
    if (trimmed !== q.original) out.set(name, trimmed);
  }
  return out;
}
