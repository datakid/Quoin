import { zipFiles, sanitizeFileName } from '../core/export/files.js';
import { tablesToXlsx } from '../core/export/xlsx.js';
import { tableToDelimited } from '../core/export/csv.js';
import { utf8Encode } from '../core/bytes.js';
import { Package } from '../core/opc.js';
import { readZip } from '../core/zip-read.js';
import { REPORT_COLUMNS, zipClock } from '../batch/execute/collect.js';
import { S, errorMessage } from '../ui/strings.js';

const GIB = 1024 * 1024 * 1024;
const CLASSIC_ZIP_ENTRIES = 0xFFFE;
const INDEX_COLUMNS = ['file', 'name', 'kind', 'load target', 'hash'];

export const collectZipName = (now) => `Collect ${now.slice(0, 10)}.zip`;

export function loadTargetText(load) {
  if (load.kind === 'connection') return S.loadConnectionOnly;
  if (load.kind === 'table') return S.loadTable(load.tableName, load.sheet);
  return load.kind;
}

function folderFor(relPath) {
  const parts = relPath.split('/').filter(Boolean);
  const last = (parts.pop() || '').replace(/\.[^.]+$/, '');
  return [...parts, last].map((p) => sanitizeFileName(p, '')).join('/');
}

function uniqueFolders(files) {
  const seen = new Set();
  const out = new Map();
  for (const f of files) {
    const base = folderFor(f.relPath);
    let name = base;
    let n = 2;
    while (seen.has(name.toLowerCase())) name = `${base}-${n++}`;
    seen.add(name.toLowerCase());
    out.set(f.id, name);
  }
  return out;
}

const table = (columns, rows) => ({ columns, rowCount: rows.length, cols: columns.map((_, i) => rows.map((r) => r[i])) });

function indexTable(indexes) {
  const rows = [];
  for (const ix of indexes) {
    if (ix.status !== 'ready') continue;
    for (const q of ix.queries) rows.push([ix.relPath, q.name, q.isFunction ? 'function' : 'query', loadTargetText(q.load), q.hash]);
    for (const m of ix.modules) rows.push([ix.relPath, m.name, 'module', m.kind, m.hash]);
  }
  return table(INDEX_COLUMNS, rows);
}

const reasonOf = (code) => (code ? errorMessage(code) : '');

export function reportRows(plan, indexes, results, runId) {
  const byId = new Map(indexes.map((ix) => [ix.id, ix]));
  const rows = [];
  for (const fp of plan.files) {
    const ix = byId.get(fp.fileId);
    const base = { run_id: runId, file: ix.name, folder: ix.relPath.slice(0, ix.relPath.length - ix.name.length), unit: '', unit_index: 0, recipe: plan.recipe.recipe, action: plan.recipe.recipe, compute: '', verdict: 'unchanged', reason_code: '', reason: '', old_hash: '', new_hash: '', output: '', verified: false, signature_removed: false, duration_ms: 0 };
    const fill = (r) => Object.fromEntries(REPORT_COLUMNS.map((k) => [k, k === 'reason' && !r.reason ? reasonOf(r.reason_code) : r[k]]));
    if (fp.skipped) rows.push(fill({ ...base, verdict: 'refused', reason_code: fp.skipped.code }));
    else if (results.has(fp.fileId)) for (const r of results.get(fp.fileId).rows) rows.push(fill(r));
    else rows.push(fill({ ...base, unit: fp.units[0] ? fp.units[0].name : '', unit_index: fp.units[0] ? fp.units[0].index : 0, verdict: 'cancelled', reason_code: 'pool.cancelled' }));
  }
  return rows;
}

async function entriesOf(zipBytes) {
  const pkg = new Package(readZip(zipBytes));
  const out = [];
  for (const name of pkg.names()) out.push({ name, data: await pkg.bytes(name) });
  return out;
}

export async function buildCollectOutput({ plan, indexes, results, now, runId, ceilingBytes = GIB, maxEntries = CLASSIC_ZIP_ENTRIES }) {
  const rows = reportRows(plan, indexes, results, runId);
  const folders = uniqueFolders(indexes.filter((ix) => results.has(ix.id) && results.get(ix.id).bytes));
  const files = [];
  let compressed = 0;
  for (const ix of indexes) {
    const result = results.get(ix.id);
    if (!result || !result.bytes) continue;
    compressed += result.bytes.length;
    for (const e of await entriesOf(result.bytes)) files.push({ name: `${folders.get(ix.id)}/${e.name}`, data: e.data });
  }
  const indexBytes = await tablesToXlsx([indexTable(indexes)], 'en-US', { now: zipClock(now) });
  const reportBytes = tableToDelimited(table(REPORT_COLUMNS, rows.map((r) => REPORT_COLUMNS.map((k) => r[k]))), { bom: true, guard: true });
  if (compressed + indexBytes.length + reportBytes.length > ceilingBytes || files.length + 2 > maxEntries) return { ok: false, code: 'output.zipTooLarge', rows };
  const bytes = await zipFiles([{ name: 'index.xlsx', data: indexBytes }, { name: 'report.csv', data: reportBytes }, ...files], { now: zipClock(now) });
  return { ok: true, bytes, name: collectZipName(now), rows, folders: [...folders.values()] };
}
