import { openWorkbook } from '../../core/workbook.js';
import { queryFile, moduleFile, zipFiles } from '../../core/export/files.js';
import { composeModuleText } from '../../core/vba/writeback.js';
import { normalizeQueryText } from '../../core/pq/section.js';
import { Package } from '../../core/opc.js';
import { readZip } from '../../core/zip-read.js';
import { DEFAULT_LIMITS } from '../../core/limits.js';
import { sha256Text, sha256Bytes } from '../index/hash.js';

export const REPORT_COLUMNS = ['run_id', 'file', 'folder', 'unit', 'unit_index', 'recipe', 'action', 'compute', 'verdict', 'reason_code', 'reason', 'old_hash', 'new_hash', 'output', 'verified', 'signature_removed', 'duration_ms'];

export function zipClock(now) {
  const t = new Date(now);
  return new Date(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), t.getUTCHours(), t.getUTCMinutes(), t.getUTCSeconds());
}

const folderOf = (relPath, name) => relPath.slice(0, relPath.length - name.length);

function row(meta, unit, values) {
  const base = { run_id: '', file: meta.name, folder: folderOf(meta.relPath, meta.name), unit: unit ? unit.name : '', unit_index: unit ? unit.index : 0, recipe: 'collect', action: 'collect', compute: '', verdict: 'unchanged', reason_code: '', reason: '', old_hash: '', new_hash: '', output: '', verified: false, signature_removed: false, duration_ms: 0 };
  const merged = { ...base, ...values };
  return Object.fromEntries(REPORT_COLUMNS.map((k) => [k, merged[k]]));
}

async function codeItems(wb) {
  const items = [];
  for (const q of wb.queries) {
    items.push({ type: 'query', name: q.name, hash: await sha256Text(normalizeQueryText(q.original)), file: { ...queryFile(q.name, q.original), name: `queries/${queryFile(q.name, '').name}` } });
  }
  const project = wb.vba && wb.vba.project;
  const codePage = project ? project.codePage : 1252;
  for (const m of project ? project.modules : []) {
    if (!m.model) continue;
    items.push({ type: 'module', name: m.name, hash: await sha256Text(m.text), file: { ...moduleFile(m, composeModuleText(m, m.model.visible), codePage), name: `modules/${moduleFile(m, '', codePage).name}` } });
  }
  return items;
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function readBack(zipBytes, items) {
  const pkg = new Package(readZip(zipBytes));
  const names = pkg.names();
  if (names.length !== items.length) return null;
  for (let i = 0; i < items.length; i++) if (!sameBytes(await pkg.bytes(names[i]), items[i].file.data)) return null;
  return names;
}

export async function executeFilePlan(bytes, meta, filePlan, options) {
  const started = performance.now();
  const op = filePlan.actions.length ? filePlan.actions[0].op : 'collect';
  if (op !== 'collect') throw new Error(`${op} is not supported yet`);
  const wb = await openWorkbook(bytes, meta.name, DEFAULT_LIMITS);
  const items = await codeItems(wb);
  const unit = filePlan.units[0] || null;
  const warnings = wb.warnings.map((w) => (w.part ? { code: w.code, part: w.part } : { code: w.code }));
  const stamp = (r) => ({ ...r, run_id: options.runId || '', duration_ms: Math.round(performance.now() - started) });
  if (!items.length) {
    return { fileId: filePlan.fileId, bytes: null, sha256: null, changes: [], warnings, rows: [row(meta, unit, stamp({ verified: true }))] };
  }
  const zip = await zipFiles(items.map((i) => i.file), { now: zipClock(options.now) });
  const names = await readBack(zip, items);
  const rows = filePlan.actions.map((a) => {
    const at = items.findIndex((i) => i.type === a.target.type && i.name === a.target.name);
    if (at < 0) return row(meta, unit, stamp({ verdict: 'skipped', reason_code: 'skip.notApplicable' }));
    if (!names) return row(meta, unit, stamp({ verdict: 'not-released', reason_code: 'verify.readBack', old_hash: items[at].hash, new_hash: items[at].hash }));
    return row(meta, unit, stamp({ old_hash: items[at].hash, new_hash: items[at].hash, output: names[at], verified: true }));
  });
  if (!names) return { fileId: filePlan.fileId, bytes: null, sha256: null, changes: [], warnings, rows };
  return { fileId: filePlan.fileId, bytes: zip, sha256: await sha256Bytes(zip), changes: [], warnings, rows };
}

export function failedResult(meta, filePlan, error, options) {
  const code = error && typeof error.code === 'string' ? error.code : 'internal';
  const unit = filePlan.units[0] || null;
  const rows = [row(meta, unit, { run_id: options.runId || '', verdict: 'failed', reason_code: code })];
  return { fileId: filePlan.fileId, bytes: null, sha256: null, changes: [], warnings: [], rows };
}
