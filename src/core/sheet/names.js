import { sanitizeFileName } from '../filename.js';

const MAX_SHEET = 31;
const MAX_FILE = 120;
const FORBIDDEN = /[:\\/?*[\]\u0000-\u001f]/g;
const EDGE_APOSTROPHES = /^'+|'+$/g;

const lower = (text) => text.toLowerCase();
const takeCodePoints = (text, n) => [...text].slice(0, Math.max(0, n)).join('');
const takeUnits = (text, n) => {
  let out = '';
  for (const point of text) {
    if (out.length + point.length > n) break;
    out += point;
  }
  return out;
};

export function sheetNameBase(raw) {
  const cleaned = String(raw === undefined || raw === null ? '' : raw).replace(FORBIDDEN, '_').replace(EDGE_APOSTROPHES, '');
  const cut = takeUnits(cleaned, MAX_SHEET).replace(EDGE_APOSTROPHES, '');
  return cut.length ? cut : 'Sheet';
}

export class NameBook {
  constructor({ sheets = [], files = [] } = {}) {
    this.sheets = new Set(sheets.map(lower));
    this.files = new Set(files.map(lower));
  }

  sheet(raw) {
    const base = sheetNameBase(raw);
    let name = base;
    for (let n = 2; this.sheets.has(lower(name)) || lower(name) === 'history'; n++) {
      const suffix = `-${n}`;
      name = takeUnits(base, MAX_SHEET - suffix.length).replace(EDGE_APOSTROPHES, '') + suffix;
    }
    this.sheets.add(lower(name));
    return name;
  }

  file(raw, ext) {
    const first = sanitizeFileName(raw, ext);
    const stem = first.slice(0, first.length - ext.length);
    let name = first;
    for (let n = 2; this.files.has(lower(name)); n++) {
      const suffix = `-${n}`;
      name = `${takeCodePoints(stem, MAX_FILE - [...ext].length - [...suffix].length).replace(/[.\s]+$/u, '')}${suffix}${ext}`;
    }
    this.files.add(lower(name));
    return name;
  }
}
