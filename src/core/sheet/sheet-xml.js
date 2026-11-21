import { kindOf } from '../m/values.js';
import { cellValue, serialOf, exportText } from '../export/cells.js';
import { indexToCol } from '../cells.js';
import { escapeText } from '../xml.js';
import { getCulture } from '../m/culture.js';
import { MAX_ROWS, MAX_COLS } from '../export/limits.js';

export function textCell(ref, text, style) {
  const s = style ? ` s="${style}"` : '';
  const space = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : '';
  return `<c r="${ref}" t="inlineStr"${s}><is><t${space}>${escapeText(text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')).replace(/\r/g, '&#13;')}</t></is></c>`;
}

export function tableCellRows(table, cultureName, styles, row0 = 0, col0 = 0) {
  const c = getCulture(cultureName);
  const styleByKind = { date: styles.date, datetime: styles.datetime, datetimezone: styles.datetime, time: styles.time, duration: styles.duration };
  const cols = Math.min(table.columns.length, MAX_COLS - col0);
  const rows = Math.min(table.rowCount, MAX_ROWS - 1 - row0);
  const out = [{ row: row0 + 1, cells: table.columns.slice(0, cols).map((n, i) => ({ col: col0 + i, xml: textCell(`${indexToCol(col0 + i)}${row0 + 1}`, n, styles.header) })) }];
  for (let r = 0; r < rows; r++) {
    const rowNumber = row0 + r + 2;
    const cells = [];
    for (let ci = 0; ci < cols; ci++) {
      const ref = `${indexToCol(col0 + ci)}${rowNumber}`;
      const cv = cellValue(table.cols[ci][r]);
      if (!cv.ok) {
        cells.push({ col: col0 + ci, xml: `<c r="${ref}" t="e"><v>#VALUE!</v></c>` });
        continue;
      }
      const v = cv.v;
      const k = kindOf(v);
      if (k === 'null') continue;
      if (k === 'number') {
        if (Number.isFinite(v)) cells.push({ col: col0 + ci, xml: `<c r="${ref}"><v>${v}</v></c>` });
        else cells.push({ col: col0 + ci, xml: `<c r="${ref}" t="e"><v>#NUM!</v></c>` });
      } else if (k === 'logical') cells.push({ col: col0 + ci, xml: `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>` });
      else if (styleByKind[k]) {
        const serial = k === 'duration' ? Number(v.ticks) / 864000000000 : serialOf(v);
        cells.push({ col: col0 + ci, xml: `<c r="${ref}" s="${styleByKind[k]}"><v>${serial}</v></c>` });
      } else cells.push({ col: col0 + ci, xml: textCell(ref, exportText(v, c)) });
    }
    out.push({ row: rowNumber, cells });
  }
  return out;
}

export function sheetXml(table, cultureName, styles) {
  const parts = tableCellRows(table, cultureName, styles).map((r) => `<row r="${r.row}">${r.cells.map((c) => c.xml).join('')}</row>`);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${parts.join('')}</sheetData></worksheet>`;
}
