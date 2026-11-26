import { cellValue, compareValues, valuesEqual, kindOf, mkDate, mkDateTime, daysFromYmd, joinDateTime, TICKS_PER_SECOND } from '../m/values.js';
import { FILTER_OPS } from './m-gen.js';

export { FILTER_OPS };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

export function viewValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object') return v;
  if (v.date) {
    const m = ISO_DATE.exec(v.date);
    if (!m) throw new Error(`"${v.date}" is not a date.`);
    return mkDate(daysFromYmd(Number(m[1]), Number(m[2]), Number(m[3])));
  }
  if (v.datetime) {
    const m = ISO_DATETIME.exec(v.datetime);
    if (!m) throw new Error(`"${v.datetime}" is not a date and time.`);
    const days = daysFromYmd(Number(m[1]), Number(m[2]), Number(m[3]));
    const seconds = Number(m[4]) * 3600 + Number(m[5]) * 60 + Number(m[6] || 0);
    return mkDateTime(joinDateTime(days, seconds * TICKS_PER_SECOND));
  }
  throw new Error('That value cannot be used in a view filter.');
}

function needText(value, column) {
  if (typeof value !== 'string') throw new Error(`The column "${column}" holds ${kindOf(value)} values here; a text filter needs text.`);
  return value;
}

function fold(text, ignoreCase) {
  return ignoreCase ? text.toUpperCase() : text;
}

function predicateFor(spec) {
  const op = spec.op;
  if (!FILTER_OPS.includes(op)) throw new Error(`The filter "${op}" is not known.`);
  if (op === 'in') {
    if (!Array.isArray(spec.values) || !spec.values.length) throw new Error('Choose at least one value.');
    const wanted = spec.values.map(viewValue);
    return (v) => wanted.some((w) => valuesEqual(w, v));
  }
  if (op === 'isNull') return (v) => valuesEqual(v, null);
  if (op === 'isNotNull') return (v) => !valuesEqual(v, null);
  const target = op === 'contains' || op === 'beginsWith' || op === 'endsWith' ? String(spec.value) : viewValue(spec.value);
  const ic = !!spec.ignoreCase;
  switch (op) {
    case 'equals':
      return (v) => valuesEqual(v, target);
    case 'notEquals':
      return (v) => !valuesEqual(v, target);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return (v) => {
        if (v === null || v === undefined || target === null) return null;
        const c = compareValues(v, target);
        return op === 'gt' ? c > 0 : op === 'gte' ? c >= 0 : op === 'lt' ? c < 0 : c <= 0;
      };
    case 'contains':
      return (v) => (v === null ? null : target === '' ? true : fold(needText(v, spec.column), ic).includes(fold(target, ic)));
    case 'beginsWith':
      return (v) => (v === null ? null : target === '' ? true : fold(needText(v, spec.column), ic).startsWith(fold(target, ic)));
    default:
      return (v) => (v === null ? null : target === '' ? true : fold(needText(v, spec.column), ic).endsWith(fold(target, ic)));
  }
}

function columnOf(table, name) {
  const i = table.columnIndex(name);
  if (i < 0) throw new Error(`The column "${name}" is not in this result.`);
  return i;
}

export function filterRows(table, filters, rows = null) {
  let keep = rows || Array.from({ length: table.rowCount }, (_, i) => i);
  for (const spec of filters) {
    const c = columnOf(table, spec.column);
    const test = predicateFor(spec);
    const col = table.cols[c];
    const next = [];
    for (const r of keep) if (test(cellValue(col[r])) === true) next.push(r);
    keep = next;
  }
  return keep;
}

export function sortRows(table, sort, rows = null) {
  const order = rows ? rows.slice() : Array.from({ length: table.rowCount }, (_, i) => i);
  if (!sort || !sort.length) return order;
  const specs = sort.map((s) => ({ col: table.cols[columnOf(table, s.column)], desc: !!s.descending }));
  const indexed = order.map((r, i) => ({ r, i }));
  indexed.sort((a, b) => {
    for (const s of specs) {
      const c = compareValues(s.col[a.r], s.col[b.r]);
      if (c) return s.desc ? -c : c;
    }
    return a.i - b.i;
  });
  return indexed.map((x) => x.r);
}

export function visibleColumns(table, hidden = []) {
  const gone = new Set(hidden);
  const out = [];
  table.columns.forEach((name, i) => {
    if (!gone.has(name)) out.push(i);
  });
  return out;
}

export function applyView(table, view) {
  try {
    const filters = view.filters || [];
    let rows = filterRows(table, filters);
    rows = sortRows(table, view.sort || [], rows);
    const columns = visibleColumns(table, view.hidden || []);
    if (!columns.length) return { ok: false, message: 'A view cannot hide every column.' };
    return { ok: true, rows, columns };
  } catch (e) {
    return { ok: false, message: String((e && (e.mMessage || e.message)) || e) };
  }
}

export function isViewEmpty(view) {
  return !view || (!(view.filters && view.filters.length) && !(view.sort && view.sort.length) && !(view.hidden && view.hidden.length));
}
