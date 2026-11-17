import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Session } from '../../src/app/session.js';
import { queryFile, moduleFile, zipFiles } from '../../src/core/export/files.js';
import { openWorkbook } from '../../src/core/workbook.js';
import { Package } from '../../src/core/opc.js';
import { readZip } from '../../src/core/zip-read.js';
import { indexWorkbook } from '../../src/batch/index/file-index.js';
import { sha256Bytes } from '../../src/batch/index/hash.js';
import { resolvePlan } from '../../src/batch/resolve/resolve.js';
import { parseRecipe } from '../../src/batch/recipe/recipe.js';
import { executeFilePlan, failedResult, zipClock, REPORT_COLUMNS } from '../../src/batch/execute/collect.js';

const NOW = '2026-11-14T10:00:00.000Z';
const WB = new URL('../fixtures/workbooks/', import.meta.url);
const EXT = new URL('../fixtures/external/', import.meta.url);
const read = (dir, name) => new Uint8Array(fs.readFileSync(new URL(name, dir)));
const recipe = parseRecipe(JSON.stringify({ recipe: 'collect', v: 1 })).recipe;

async function planFor(bytes, name, relPath = name) {
  const meta = { id: 'f0001', name, relPath, size: bytes.length };
  const index = await indexWorkbook(bytes, meta);
  const plan = resolvePlan(recipe, [index], { now: NOW });
  return { meta, index, filePlan: plan.files[0] };
}

async function singleFileZip(bytes, name) {
  const s = new Session();
  await s.open(new File([bytes], name));
  const files = [];
  for (const q of s.queries) files.push({ ...queryFile(q.name, s.textOf({ type: 'query', name: q.name })), name: `queries/${queryFile(q.name, '').name}` });
  const cp = s.wb.vba && s.wb.vba.project ? s.wb.vba.project.codePage : 1252;
  for (const m of s.modules) files.push({ ...moduleFile(m, s.composeModule(m.name), cp), name: `modules/${moduleFile(m, '', cp).name}` });
  return zipFiles(files, { now: zipClock(NOW) });
}

const entriesOf = async (zipBytes) => {
  const pkg = new Package(readZip(zipBytes));
  const out = new Map();
  for (const n of pkg.names()) out.set(n, await pkg.bytes(n));
  return out;
};

const CASES = [
  [WB, 'mixed.xlsm'],
  [WB, 'signed.xlsm'],
  [EXT, 'pq_vba_complex.xlsm'],
  [EXT, 'pq_simple.xlsx']
];

for (const [dir, name] of CASES) {
  test(`collect output for ${name} equals the single-file "everything" zip byte for byte`, async () => {
    const bytes = read(dir, name);
    const { meta, filePlan } = await planFor(bytes, name);
    const result = await executeFilePlan(bytes, meta, filePlan, { now: NOW, runId: 'r1' });
    const expected = await singleFileZip(bytes, name);
    assert.ok(result.bytes instanceof Uint8Array);
    assert.deepEqual(result.bytes, expected);
    assert.equal(result.sha256, await sha256Bytes(expected));
  });
}

test('the zip holds queries under queries/ and modules under modules/ with the extensions used today', async () => {
  const bytes = read(WB, 'mixed.xlsm');
  const { meta, filePlan } = await planFor(bytes, 'mixed.xlsm');
  const result = await executeFilePlan(bytes, meta, filePlan, { now: NOW, runId: 'r1' });
  assert.deepEqual([...(await entriesOf(result.bytes)).keys()], ['queries/fGetNamedRange.m', 'queries/RawInput.m', 'queries/FinalTable.m', 'modules/Module1.bas', 'modules/ThisWorkbook.cls', 'modules/Sheet1.cls']);
});

test('the report columns are the ones in the plan, in order', () => {
  assert.deepEqual(REPORT_COLUMNS, ['run_id', 'file', 'folder', 'unit', 'unit_index', 'recipe', 'action', 'compute', 'verdict', 'reason_code', 'reason', 'old_hash', 'new_hash', 'output', 'verified', 'signature_removed', 'duration_ms']);
});

test('every action gets one report row with the hashes the index holds and the zip entry it went to', async () => {
  const bytes = read(WB, 'mixed.xlsm');
  const { meta, index, filePlan } = await planFor(bytes, 'mixed.xlsm', 'east/mixed.xlsm');
  const result = await executeFilePlan(bytes, meta, filePlan, { now: NOW, runId: 'r1' });
  assert.equal(result.rows.length, filePlan.actions.length);
  for (const row of result.rows) assert.deepEqual(Object.keys(row), REPORT_COLUMNS);
  const first = result.rows[0];
  assert.deepEqual([first.run_id, first.file, first.folder, first.unit, first.unit_index, first.recipe, first.action, first.compute, first.verdict, first.reason_code, first.reason, first.verified, first.signature_removed], ['r1', 'mixed.xlsm', 'east/', 'mixed', 1, 'collect', 'collect', '', 'unchanged', '', '', true, false]);
  assert.equal(typeof first.duration_ms, 'number');
  const names = [...(await entriesOf(result.bytes)).keys()];
  assert.deepEqual(result.rows.map((r) => r.output), names);
  const hashes = [...index.queries.map((q) => q.hash), ...index.modules.map((m) => m.hash)];
  assert.deepEqual(result.rows.map((r) => r.old_hash), hashes);
  assert.deepEqual(result.rows.map((r) => r.new_hash), hashes);
});

test('a file with nothing to collect gives no bytes and one unchanged row', async () => {
  const bytes = read(EXT, 'plain_table.xlsx');
  const { meta, filePlan } = await planFor(bytes, 'plain_table.xlsx');
  const result = await executeFilePlan(bytes, meta, filePlan, { now: NOW, runId: 'r1' });
  assert.deepEqual([result.bytes, result.sha256, result.changes, result.rows.length], [null, null, [], 1]);
  assert.deepEqual([result.rows[0].verdict, result.rows[0].output, result.rows[0].old_hash, result.rows[0].new_hash], ['unchanged', '', '', '']);
});

test('the same input and time give the same bytes and hash, a different time gives different bytes', async () => {
  const bytes = read(WB, 'mixed.xlsm');
  const { meta, filePlan } = await planFor(bytes, 'mixed.xlsm');
  const a = await executeFilePlan(bytes, meta, filePlan, { now: NOW, runId: 'r1' });
  const b = await executeFilePlan(bytes, meta, filePlan, { now: NOW, runId: 'r2' });
  const c = await executeFilePlan(bytes, meta, filePlan, { now: '2027-01-02T03:04:06.000Z', runId: 'r1' });
  assert.deepEqual(a.bytes, b.bytes);
  assert.equal(a.sha256, b.sha256);
  assert.notEqual(a.sha256, c.sha256);
});

test('the zip clock shows the frozen UTC time whatever the local time zone is', () => {
  const d = zipClock('2026-11-14T10:20:30.000Z');
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()], [2026, 10, 14, 10, 20, 30]);
});

test('the input bytes are never changed', async () => {
  const bytes = read(WB, 'signed.xlsm');
  const copy = bytes.slice();
  const { meta, filePlan } = await planFor(bytes, 'signed.xlsm');
  await executeFilePlan(bytes, meta, filePlan, { now: NOW, runId: 'r1' });
  assert.deepEqual(bytes, copy);
});

test('a result carries its file id and valid report arrays', async () => {
  const bytes = read(WB, 'mixed.xlsm');
  const { meta, filePlan } = await planFor(bytes, 'mixed.xlsm');
  const result = await executeFilePlan(bytes, meta, filePlan, { now: NOW, runId: 'r1' });
  assert.equal(result.fileId, 'f0001');
  assert.deepEqual([Array.isArray(result.changes), Array.isArray(result.warnings), Array.isArray(result.rows)], [true, true, true]);
  assert.deepEqual(structuredClone(result.rows), result.rows);
});

test('an action that is not collect is refused until its phase', async () => {
  const bytes = read(WB, 'mixed.xlsm');
  const { meta, filePlan } = await planFor(bytes, 'mixed.xlsm');
  const other = { ...filePlan, actions: [{ ...filePlan.actions[0], op: 'replace' }] };
  await assert.rejects(() => executeFilePlan(bytes, meta, other, { now: NOW, runId: 'r1' }), /replace/);
});

test('a workbook that cannot be opened rejects so the worker can report the file as failed', async () => {
  const bad = new Uint8Array([1, 2, 3, 4]);
  const filePlan = { fileId: 'f0001', source: 'rule', units: [{ fileId: 'f0001', kind: 'workbook', name: 'x', index: 1 }], actions: [], skipped: null };
  await assert.rejects(() => executeFilePlan(bad, { id: 'f0001', name: 'x.xlsx', relPath: 'x.xlsx', size: 4 }, filePlan, { now: NOW, runId: 'r1' }));
});

test('the workbook opened here is the one the index described', async () => {
  const bytes = read(WB, 'mixed.xlsm');
  const wb = await openWorkbook(bytes, 'mixed.xlsm');
  const { filePlan } = await planFor(bytes, 'mixed.xlsm');
  assert.equal(filePlan.actions.filter((a) => a.target.type === 'query').length, wb.queries.length);
});

test('a failed file gives no bytes and one failed row carrying the error code', () => {
  const filePlan = { fileId: 'f0001', source: 'rule', units: [{ fileId: 'f0001', kind: 'workbook', name: 'x', index: 1 }], actions: [], skipped: null };
  const meta = { id: 'f0001', name: 'x.xlsx', relPath: 'a/x.xlsx', size: 4 };
  const withCode = failedResult(meta, filePlan, Object.assign(new Error('x'), { code: 'zip.eocd' }), { runId: 'r9' });
  assert.deepEqual([withCode.fileId, withCode.bytes, withCode.sha256, withCode.rows.length], ['f0001', null, null, 1]);
  assert.deepEqual([withCode.rows[0].verdict, withCode.rows[0].reason_code, withCode.rows[0].run_id, withCode.rows[0].folder, withCode.rows[0].verified], ['failed', 'zip.eocd', 'r9', 'a/', false]);
  assert.equal(failedResult(meta, filePlan, new TypeError('x'), {}).rows[0].reason_code, 'internal');
  assert.deepEqual(Object.keys(withCode.rows[0]), REPORT_COLUMNS);
});
