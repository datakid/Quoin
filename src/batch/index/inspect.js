import { openWorkbook } from '../../core/workbook.js';
import { DEFAULT_LIMITS } from '../../core/limits.js';
import { INSPECT_NEEDS } from '../protocol.js';
import { indexWorkbook } from './file-index.js';

const HAS_CELL_CONTENT = /<c\b[^>]*>\s*<(?:v|f|is)(?:\s[^>]*)?(?<!\/)>/;

async function fillNonEmpty(wb, index) {
  for (const sheet of index.sheets) {
    if (sheet.type !== 'worksheet' || !sheet.part) continue;
    const text = await wb.pkg.text(sheet.part);
    sheet.nonEmpty = HAS_CELL_CONTENT.test(text.text);
  }
}

export async function inspectWorkbook(bytes, meta, need, { limits = DEFAULT_LIMITS } = {}) {
  for (const n of need) if (!INSPECT_NEEDS.includes(n)) throw new Error(`unknown need ${n}`);
  const index = await indexWorkbook(bytes, meta, { limits });
  if (index.status !== 'ready' || !need.includes('nonEmpty')) return index;
  const wb = await openWorkbook(bytes, meta.name, limits);
  await fillNonEmpty(wb, index);
  return index;
}
