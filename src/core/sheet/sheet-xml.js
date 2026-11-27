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

export function sheetXml(table, cultureName, styles) {
  const c = getCulture(cultureName);
  const styleByKind = { date: styles.date, datetime: styles.datetime, datetimezone: styles.datetime, time: styles.time, duration: styles.duration };
  const cols = Math.min(table.columns.length, MAX_COLS);
  const rows = Math.min(table.rowCount, MAX_ROWS - 1);
  const parts = [];
  parts.push(`<row r="1">${table.columns.slice(0, cols).map((n, i) => textCell(`${indexToCol(i)}1`, n, styles.header)).join('')}</row>`);
  for (let r = 0; r < rows; r++) {
    const cells = [];
    for (let ci = 0; ci < cols; ci++) {
      const ref = `${indexToCol(ci)}${r + 2}`;
      const cv = cellValue(table.cols[ci][r]);
      if (!cv.ok) {
        cells.push(`<c r="${ref}" t="e"><v>#VALUE!</v></c>`);
        continue;
      }
      const v = cv.v;
      const k = kindOf(v);
      if (k === 'null') continue;
      if (k === 'number') {
        if (Number.isFinite(v)) cells.push(`<c r="${ref}"><v>${v}</v></c>`);
        else cells.push(`<c r="${ref}" t="e"><v>#NUM!</v></c>`);
      } else if (k === 'logical') cells.push(`<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`);
      else if (styleByKind[k]) {
        const serial = k === 'duration' ? Number(v.ticks) / 864000000000 : serialOf(v);
        cells.push(`<c r="${ref}" s="${styleByKind[k]}"><v>${serial}</v></c>`);
      } else cells.push(textCell(ref, exportText(v, c)));
    }
    parts.push(`<row r="${r + 2}">${cells.join('')}</row>`);
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${parts.join('')}</sheetData></worksheet>`;
}
