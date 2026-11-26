import { openWorkbook } from '../../core/workbook.js';
import { normalizeQueryText } from '../../core/pq/section.js';
import { indexSection } from '../../core/wb/deps.js';
import { DEFAULT_LIMITS } from '../../core/limits.js';
import { refusalFor } from './refusal.js';
import { sha256Text } from './hash.js';

const SUPPORTED_EXTENSION = /\.(xlsx|xlsm|xltx|xltm)$/i;

function shell(meta, status, refused, format) {
  return {
    id: meta.id,
    name: meta.name,
    relPath: meta.relPath,
    size: meta.size,
    inflated: 0,
    status,
    refused,
    format,
    sheets: [],
    tables: [],
    queries: [],
    modules: [],
    pq: { editable: false, reason: null },
    vba: { present: false, signed: false, locked: false, writable: false },
    warnings: []
  };
}

const refusedIndex = (meta, code) => shell(meta, 'refused', { code }, null);

function pqState(wb) {
  const m = wb.mashup;
  if (!m) return { editable: false, reason: 'pq.none' };
  if (m.error || m.model.warnings.length || m.split.errors.length) return { editable: false, reason: 'pq.format' };
  return { editable: true, reason: null };
}

function loadOf(load) {
  if (load.kind !== 'table') return { kind: load.kind };
  return { kind: load.kind, sheet: load.sheet, ref: load.ref, tableName: load.tableName };
}

async function queriesOf(wb) {
  const functions = new Set();
  if (wb.mashup && !wb.mashup.error) for (const m of indexSection(wb.mashup.section.text).members) if (m.isFunction) functions.add(m.name);
  const out = [];
  for (const q of wb.queries) out.push({ name: q.name, isFunction: functions.has(q.name), load: loadOf(q.load), hash: await sha256Text(normalizeQueryText(q.original)) });
  return out;
}

async function modulesOf(wb) {
  const project = wb.vba && wb.vba.project;
  if (!project) return [];
  const out = [];
  for (const m of project.modules) out.push({ name: m.name, kind: m.kind, hash: typeof m.text === 'string' ? await sha256Text(m.text) : null });
  return out;
}

export function refusalByName(name) {
  if (name.startsWith('~$')) return 'file.lockFile';
  if (!SUPPORTED_EXTENSION.test(name)) return 'file.unsupportedExtension';
  return null;
}

export async function indexWorkbook(bytes, meta, { limits = DEFAULT_LIMITS } = {}) {
  const byName = refusalByName(meta.name);
  if (byName) return refusedIndex(meta, byName);
  let wb;
  try {
    wb = await openWorkbook(bytes, meta.name, limits);
  } catch (e) {
    const code = refusalFor(e);
    if (!code) throw e;
    return refusedIndex(meta, code);
  }
  const ix = shell(meta, 'ready', null, wb.format);
  ix.inflated = wb.inflatedBytes;
  ix.sheets = wb.sheets.map((s, i) => ({ name: s.name, index: i, state: s.state, type: s.type, part: s.part, nonEmpty: null }));
  ix.tables = wb.tables.map((t) => ({ name: t.displayName, sheet: t.sheet, ref: t.ref, headerRowCount: t.headerRowCount, tableType: t.tableType }));
  ix.queries = await queriesOf(wb);
  ix.modules = await modulesOf(wb);
  ix.pq = pqState(wb);
  const v = wb.vba;
  const p = v && v.project;
  ix.vba = { present: !!v, signed: !!(v && v.signed), locked: !!(p && p.locked), writable: !!(p && p.writable) };
  ix.warnings = wb.warnings.map((w) => (w.part ? { code: w.code, part: w.part } : { code: w.code }));
  return ix;
}
