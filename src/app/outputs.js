import { zipFiles, sanitizeFileName } from '../core/export/files.js';
import { tablesToXlsx } from '../core/export/xlsx.js';
import { tableToDelimited } from '../core/export/csv.js';
import { utf8Encode } from '../core/bytes.js';
import { Package } from '../core/opc.js';
import { readZip } from '../core/zip-read.js';
import { REPORT_COLUMNS, zipClock } from '../batch/execute/collect.js';
import { S, reasonWords } from '../ui/strings.js';

const GIB = 1024 * 1024 * 1024;
const CLASSIC_ZIP_ENTRIES = 0xFFFE;
const INDEX_COLUMNS = ['file', 'name', 'kind', 'load target', 'hash'];

export const collectZipName = (now) => `Collect ${now.slice(0, 10)}.zip`;

const PLAN_KIND = { inject: 'Inject', replace: 'Replace', align: 'Align', transform: 'Transform' };
const YES_NO = ['verified', 'signature_removed'];

export const planZipName = (kind, now) => `${PLAN_KIND[kind] || 'Run'} ${now.slice(0, 10)}.zip`;

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

export function reportRows(plan, indexes, results, runId) {
  const byId = new Map(indexes.map((ix) => [ix.id, ix]));
  const rows = [];
  for (const fp of plan.files) {
    const ix = byId.get(fp.fileId);
    const base = { run_id: runId, file: ix.name, folder: ix.relPath.slice(0, ix.relPath.length - ix.name.length), unit: '', unit_index: 0, recipe: plan.recipe.recipe, action: plan.recipe.recipe, compute: '', verdict: 'unchanged', reason_code: '', reason: '', old_hash: '', new_hash: '', output: '', verified: false, signature_removed: false, duration_ms: 0 };
    const fill = (r) => Object.fromEntries(REPORT_COLUMNS.map((k) => [k, k === 'reason' ? reasonWords(r) : r[k]]));
    if (fp.skipped) rows.push(fill({ ...base, verdict: fp.skipped.code.startsWith('skip.') ? 'skipped' : 'refused', reason_code: fp.skipped.code }));
    else if (results.has(fp.fileId)) for (const r of results.get(fp.fileId).rows) rows.push(fill(r));
    else rows.push(fill({ ...base, unit: fp.units[0] ? fp.units[0].name : '', unit_index: fp.units[0] ? fp.units[0].index : 0, verdict: 'cancelled', reason_code: 'pool.cancelled' }));
  }
  return rows;
}

export function reportCsvBytes(rows) {
  const cell = (r, k) => (YES_NO.includes(k) ? (r[k] ? 'yes' : 'no') : r[k]);
  return tableToDelimited(table(REPORT_COLUMNS, rows.map((r) => REPORT_COLUMNS.map((k) => cell(r, k)))), { bom: true, guard: true });
}

function outputParts(relPath) {
  const parts = relPath.split('/').filter(Boolean);
  const file = parts.pop() || '';
  const dot = file.lastIndexOf('.');
  const ext = dot > 0 ? file.slice(dot) : '';
  return { folders: parts.map((p) => sanitizeFileName(p, '')), stem: sanitizeFileName(file, ext), ext };
}

const outputKey = (fileId, output) => (output ? `${fileId}\t${output}` : fileId);

function releasedItems(result) {
  if (result.outputs && result.outputs.length) return result.outputs.filter((o) => o.bytes).map((o) => ({ output: o.name, data: o.bytes }));
  return result.bytes ? [{ output: '', data: result.bytes }] : [];
}

export function releasedFiles({ indexes, perFile }) {
  const seen = new Set();
  const out = [];
  for (const ix of indexes) {
    const result = perFile.get(ix.id);
    if (!result) continue;
    const { folders, stem, ext } = outputParts(ix.relPath);
    for (const item of releasedItems(result)) {
      const wanted = item.output ? outputParts(item.output) : { stem, ext };
      const base = wanted.ext ? wanted.stem.slice(0, wanted.stem.length - wanted.ext.length) : wanted.stem;
      let name = wanted.stem;
      let n = 2;
      while (seen.has([...folders, name].join('/').toLowerCase())) name = `${base}-${n++}${wanted.ext}`;
      const path = [...folders, name].join('/');
      seen.add(path.toLowerCase());
      out.push({ fileId: ix.id, key: outputKey(ix.id, item.output), path, data: item.data });
    }
  }
  return out;
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
  const reportBytes = reportCsvBytes(rows);
  if (compressed + indexBytes.length + reportBytes.length > ceilingBytes || files.length + 2 > maxEntries) return { ok: false, code: 'output.zipTooLarge', rows };
  const bytes = await zipFiles([{ name: 'index.xlsx', data: indexBytes }, { name: 'report.csv', data: reportBytes }, ...files], { now: zipClock(now) });
  return { ok: true, bytes, name: collectZipName(now), rows, folders: [...folders.values()] };
}

export function fillOutputs(rows, indexes, pathOf) {
  const idOf = new Map(indexes.map((ix) => [ix.relPath, ix.id]));
  return rows.map((r) => {
    const id = idOf.get(`${r.folder}${r.file}`);
    const path = pathOf.get(outputKey(id, r.output)) || pathOf.get(id);
    return r.verdict === 'changed' ? { ...r, output: path || '' } : r;
  });
}

export async function buildPlanOutput({ plan, indexes, perFile, rows, now, ceilingBytes = GIB, maxEntries = CLASSIC_ZIP_ENTRIES }) {
  const files = releasedFiles({ indexes, perFile });
  const filled = fillOutputs(rows, indexes, new Map(files.map((f) => [f.key, f.path])));
  const reportBytes = reportCsvBytes(filled);
  const compressed = files.reduce((n, f) => n + f.data.length, 0);
  if (compressed + reportBytes.length > ceilingBytes || files.length + 1 > maxEntries) return { ok: false, code: 'output.zipTooLarge', rows: filled };
  const bytes = await zipFiles([{ name: 'report.csv', data: reportBytes }, ...files.map((f) => ({ name: f.path, data: f.data }))], { now: zipClock(now) });
  return { ok: true, bytes, name: planZipName(plan.recipe.recipe, now), rows: filled, files: files.map((f) => f.path), reportBytes };
}
