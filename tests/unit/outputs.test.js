import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildCollectOutput, collectZipName, loadTargetText } from '../../src/app/outputs.js';
import { tableToXlsx, tablesToXlsx } from '../../src/core/export/xlsx.js';
import { openWorkbook } from '../../src/core/workbook.js';
import { readUsedGrid } from '../../src/core/cells.js';
import { Package } from '../../src/core/opc.js';
import { readZip } from '../../src/core/zip-read.js';
import { runOnce } from '../../src/core/m/engine.js';
import { indexWorkbook } from '../../src/batch/index/file-index.js';
import { resolvePlan } from '../../src/batch/resolve/resolve.js';
import { parseRecipe } from '../../src/batch/recipe/recipe.js';
import { executeFilePlan, failedResult, REPORT_COLUMNS } from '../../src/batch/execute/collect.js';
import { errorMessage } from '../../src/ui/strings.js';
import { baseOptions } from './helpers.js';

const NOW = '2026-11-14T10:00:00.000Z';
const WB = new URL('../fixtures/workbooks/', import.meta.url);
const EXT = new URL('../fixtures/external/', import.meta.url);
const read = (dir, name) => new Uint8Array(fs.readFileSync(new URL(name, dir)));
const recipe = parseRecipe(JSON.stringify({ recipe: 'collect', v: 1 })).recipe;

async function scenario(specs) {
  const indexes = [];
  const sources = new Map();
  let n = 0;
  for (const [dir, name, relPath] of specs) {
    const bytes = dir ? read(dir, name) : new Uint8Array([1, 2, 3]);
    const path = relPath || name;
    const meta = { id: `f${String(++n).padStart(4, '0')}`, name: path.split('/').pop(), relPath: path, size: bytes.length };
    indexes.push(await indexWorkbook(bytes, meta));
    sources.set(meta.id, { bytes, meta });
  }
  const plan = resolvePlan(recipe, indexes, { now: NOW });
  const results = new Map();
  for (const fp of plan.files) {
    if (fp.skipped) continue;
    const { bytes, meta } = sources.get(fp.fileId);
    results.set(fp.fileId, await executeFilePlan(bytes, meta, fp, { now: NOW, runId: 'r1' }));
  }
  return { plan, indexes, results, sources };
}

const names = (zipBytes) => new Package(readZip(zipBytes)).names();
const entry = async (zipBytes, name) => new Package(readZip(zipBytes)).bytes(name);
const text = (u8) => new TextDecoder().decode(u8);
const csvLines = (u8) => text(u8.slice(3)).split('\r\n').filter(Boolean);

test('tablesToXlsx with one table is byte-compatible with tableToXlsx, and with more it gives one sheet each', async () => {
  const r = runOnce({ ...baseOptions, sectionText: 'section Section1;\r\n\r\nshared Q = #table({"Name","Qty"}, {{"x", 2.5}, {"<&>", -1}});', queryName: 'Q' });
  const t = r.value;
  assert.deepEqual(await tablesToXlsx([t], 'en-US'), await tableToXlsx(t, 'en-US'));
  const many = await openWorkbook(await tablesToXlsx([t, t]), 'many.xlsx');
  assert.deepEqual(many.sheets.map((x) => x.name), ['Result', 'Result-2']);
});

test('each ready file gets a folder named after its path without the extension, with the same entries as its own zip', async () => {
  const s = await scenario([[WB, 'mixed.xlsm', 'east/mixed.xlsm'], [EXT, 'pq_simple.xlsx', 'west/pq_simple.xlsx']]);
  const out = await buildCollectOutput({ ...s, now: NOW, runId: 'r1' });
  assert.equal(out.ok, true);
  const all = names(out.bytes);
  assert.deepEqual(all.slice(0, 2), ['index.xlsx', 'report.csv']);
  const mixed = [...(await new Package(readZip(s.results.get('f0001').bytes)).names())].map((n) => `east/mixed/${n}`);
  assert.deepEqual(all.filter((n) => n.startsWith('east/mixed/')), mixed);
  assert.equal(all.some((n) => n.startsWith('west/pq_simple/queries/')), true);
  for (const n of mixed) assert.deepEqual(await entry(out.bytes, n), await entry(s.results.get('f0001').bytes, n.replace('east/mixed/', '')));
});

test('folder names are sanitised per path segment and collisions get -2, ignoring case', async () => {
  const s = await scenario([[WB, 'mixed.xlsm', 'dir:x/Book*1.xlsm'], [WB, 'signed.xlsm', 'dir:x/book*1.xlsx'], [WB, 'mixed.xlsm', 'dir:x/book*1.xlsb.xlsm']]);
  const out = await buildCollectOutput({ ...s, now: NOW, runId: 'r1' });
  const folders = [...new Set(names(out.bytes).filter((n) => n.includes('/')).map((n) => n.split('/').slice(0, -2).join('/')))];
  assert.deepEqual(folders.filter(Boolean), ['dir_x/Book_1', 'dir_x/book_1-2', 'dir_x/book_1.xlsb']);
});

test('index.xlsx lists every query and module with file, name, kind, load target and full hash', async () => {
  const s = await scenario([[WB, 'mixed.xlsm', 'east/mixed.xlsm']]);
  const out = await buildCollectOutput({ ...s, now: NOW, runId: 'r1' });
  const wb = await openWorkbook(await entry(out.bytes, 'index.xlsx'), 'index.xlsx');
  const grid = await readUsedGrid(wb, wb.sheets[0].name);
  const rows = grid.map((r) => r.map((c) => (c ? c.v : '')));
  assert.deepEqual(rows[0], ['file', 'name', 'kind', 'load target', 'hash']);
  const ix = s.indexes[0];
  assert.equal(rows.length, 1 + ix.queries.length + ix.modules.length);
  assert.deepEqual(rows[1], ['east/mixed.xlsm', 'fGetNamedRange', 'function', loadTargetText(ix.queries[0].load), ix.queries[0].hash]);
  assert.deepEqual(rows[2].slice(0, 3), ['east/mixed.xlsm', 'RawInput', 'query']);
  const modules = rows.slice(1 + ix.queries.length);
  assert.deepEqual(modules.map((r) => [r[1], r[2], r[3], r[4]]), ix.modules.map((m) => [m.name, 'module', m.kind, m.hash]));
});

test('load targets read as plain words', () => {
  assert.equal(loadTargetText({ kind: 'connection' }), 'connection only');
  assert.equal(loadTargetText({ kind: 'table', sheet: 'Input', ref: 'A1:C9', tableName: 'RawInput' }), 'table RawInput on Input');
  assert.equal(loadTargetText({ kind: 'sheet' }), 'sheet');
});

test('report.csv has a BOM, the report columns, one row per action and a row for every other file', async () => {
  const s = await scenario([[WB, 'mixed.xlsm', 'a/mixed.xlsm'], [EXT, 'plain_table.xlsx', 'b/plain_table.xlsx'], [null, 'old.xls', 'c/old.xls']]);
  const out = await buildCollectOutput({ ...s, now: NOW, runId: 'r1' });
  const csv = await entry(out.bytes, 'report.csv');
  assert.deepEqual([...csv.slice(0, 3)], [0xEF, 0xBB, 0xBF]);
  const lines = csvLines(csv);
  assert.equal(lines[0], REPORT_COLUMNS.join(','));
  assert.equal(lines.length, 1 + 6 + 1 + 1);
  assert.equal(out.rows.length, 8);
  const refused = out.rows.find((r) => r.file === 'old.xls');
  assert.deepEqual([refused.verdict, refused.unit, refused.reason_code, refused.reason, refused.folder], ['refused', '', 'file.unsupportedExtension', errorMessage('file.unsupportedExtension'), 'c/']);
  const plain = out.rows.find((r) => r.file === 'plain_table.xlsx');
  assert.deepEqual([plain.verdict, plain.output], ['unchanged', '']);
});

test('a file that failed or has no result still appears, as failed or cancelled', async () => {
  const s = await scenario([[WB, 'mixed.xlsm', 'a/mixed.xlsm'], [EXT, 'pq_simple.xlsx', 'b/pq_simple.xlsx']]);
  const fp = s.plan.files[0];
  s.results.set(fp.fileId, failedResult(s.sources.get(fp.fileId).meta, fp, Object.assign(new Error('x'), { code: 'zip.eocd' }), { runId: 'r1' }));
  s.results.delete(s.plan.files[1].fileId);
  const out = await buildCollectOutput({ ...s, now: NOW, runId: 'r1' });
  const a = out.rows.filter((r) => r.file === 'mixed.xlsm');
  const b = out.rows.filter((r) => r.file === 'pq_simple.xlsx');
  assert.deepEqual([a.length, a[0].verdict, a[0].reason_code], [1, 'failed', 'zip.eocd']);
  assert.deepEqual([b.length, b[0].verdict, b[0].reason_code], [1, 'cancelled', 'pool.cancelled']);
  assert.equal(names(out.bytes).some((n) => n.startsWith('a/mixed/')), false);
});

test('the report guards file names that start like a formula', async () => {
  const s = await scenario([[WB, 'mixed.xlsm', '=cmd.xlsm']]);
  const out = await buildCollectOutput({ ...s, now: NOW, runId: 'r1' });
  assert.match(text(await entry(out.bytes, 'report.csv')), /\r\nr1,'=cmd\.xlsm,/);
});

test('the same inputs and time give the same zip bytes', async () => {
  const s = await scenario([[WB, 'mixed.xlsm', 'a/mixed.xlsm'], [WB, 'signed.xlsm', 'b/signed.xlsm']]);
  const a = await buildCollectOutput({ ...s, now: NOW, runId: 'r1' });
  const b = await buildCollectOutput({ ...s, now: NOW, runId: 'r1' });
  assert.deepEqual(a.bytes, b.bytes);
});

test('index.xlsx carries the frozen time in its own package, so Preview and Run give the same bytes', async () => {
  const s = await scenario([[WB, 'mixed.xlsm', 'a/mixed.xlsm']]);
  const frozen = '2020-02-02T02:02:02.000Z';
  const out = await buildCollectOutput({ ...s, now: frozen, runId: 'r1' });
  const outer = readZip(out.bytes);
  const index = outer.entries.find((e) => e.name === 'index.xlsx');
  const inner = readZip(await new Package(outer).bytes('index.xlsx'));
  const expected = ((2020 - 1980) << 9) | (2 << 5) | 2;
  assert.equal(index.modDate, expected);
  assert.ok(inner.entries.length > 0);
  for (const e of inner.entries) assert.equal(e.modDate, expected, e.name);
});

test('outputs above the zip ceiling are refused with output.zipTooLarge', async () => {
  const s = await scenario([[WB, 'mixed.xlsm', 'a/mixed.xlsm']]);
  const out = await buildCollectOutput({ ...s, now: NOW, runId: 'r1', ceilingBytes: 10 });
  assert.deepEqual([out.ok, out.code], [false, 'output.zipTooLarge']);
  assert.equal((await buildCollectOutput({ ...s, now: NOW, runId: 'r1', ceilingBytes: 1e9 })).ok, true);
});

test('more entries than a classic zip holds are refused the same way', async () => {
  const s = await scenario([[WB, 'mixed.xlsm', 'a/mixed.xlsm']]);
  const out = await buildCollectOutput({ ...s, now: NOW, runId: 'r1', maxEntries: 3 });
  assert.deepEqual([out.ok, out.code], [false, 'output.zipTooLarge']);
});

test('the zip name carries the date', () => {
  assert.equal(collectZipName('2026-11-14T23:59:59.000Z'), 'Collect 2026-11-14.zip');
});

test('an empty set still builds an index and a report', async () => {
  const out = await buildCollectOutput({ plan: resolvePlan(recipe, [], { now: NOW }), indexes: [], results: new Map(), now: NOW, runId: 'r1' });
  assert.deepEqual(names(out.bytes), ['index.xlsx', 'report.csv']);
  assert.equal(csvLines(await entry(out.bytes, 'report.csv')).length, 1);
});
