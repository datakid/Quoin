import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startCollect } from '../../src/app/collect-run.js';
import { SetSession } from '../../src/app/set-session.js';
import { indexWorkbook } from '../../src/batch/index/file-index.js';
import { executeFilePlan } from '../../src/batch/execute/collect.js';
import { appliedMessage, refusedMessage } from '../../src/batch/protocol.js';
import { Package } from '../../src/core/opc.js';
import { readZip } from '../../src/core/zip-read.js';

const NOW = '2026-11-14T10:00:00.000Z';
const WB = new URL('../fixtures/workbooks/', import.meta.url);
const EXT = new URL('../fixtures/external/', import.meta.url);
const read = (dir, name) => new Uint8Array(fs.readFileSync(new URL(name, dir)));

async function settledSet(specs) {
  const s = new SetSession();
  s.addFiles(specs.map(([dir, name, relPath]) => ({ name: (relPath || name).split('/').pop(), relPath: relPath || name, size: 3, lastModified: 1, file: new Blob([dir ? read(dir, name) : new Uint8Array([1, 2, 3])]) })));
  for (const f of s.list()) {
    const bytes = new Uint8Array(await f.file.arrayBuffer());
    const index = await indexWorkbook(bytes, { id: f.id, name: f.name, relPath: f.relPath, size: f.size });
    if (index.status === 'ready') s.indexed(f.id, index);
    else s.refused(f.id, index.refused.code);
  }
  return s;
}

function inProcessPool({ hold = false, failIds = [], refuseIds = [] } = {}) {
  const pending = [];
  const pool = {
    submitted: [],
    cancelledWith: [],
    async submit({ message }) {
      pool.submitted.push(message.fileRef.id);
      if (hold) return new Promise((resolve) => pending.push(resolve));
      const id = message.fileRef.id;
      if (failIds.includes(id)) return { status: 'failed', error: 'crash' };
      if (refuseIds.includes(id)) return { status: 'done', message: refusedMessage(id, 'file.notWorkbook') };
      const bytes = new Uint8Array(await message.fileRef.file.arrayBuffer());
      const meta = { id, name: message.fileRef.name, relPath: message.fileRef.relPath, size: message.fileRef.size };
      return { status: 'done', message: appliedMessage(id, await executeFilePlan(bytes, meta, message.filePlan, message.options)) };
    },
    cancel(target) {
      pool.cancelledWith.push(target);
      while (pending.length) pending.shift()({ status: 'cancelled' });
    }
  };
  return pool;
}

const names = (zip) => new Package(readZip(zip)).names();

test('a collect run moves the session through running to done and returns the zip', async () => {
  const s = await settledSet([[WB, 'mixed.xlsm', 'east/mixed.xlsm'], [EXT, 'pq_simple.xlsx', 'west/pq_simple.xlsx'], [null, 'old.xls', 'old.xls']]);
  const states = [];
  s.subscribe((e) => e.type === 'state' && states.push(e.state));
  const pool = inProcessPool();
  const run = startCollect({ session: s, pool, now: NOW, runId: 'r1' });
  assert.deepEqual([s.state, s.move, s.progress], ['running', 'get', { done: 0, total: 2 }]);
  const out = await run.promise;
  assert.equal(out.ok, true);
  assert.deepEqual(states, ['running', 'done']);
  assert.deepEqual([s.state, s.move, s.progress], ['done', null, null]);
  assert.deepEqual(pool.submitted.sort(), ['f0001', 'f0002']);
  const all = names(out.bytes);
  assert.deepEqual(all.slice(0, 2), ['index.xlsx', 'report.csv']);
  assert.equal(all.some((n) => n.startsWith('east/mixed/queries/')), true);
  assert.equal(out.rows.length > 3, true);
  assert.equal(out.rows.find((r) => r.file === 'old.xls').verdict, 'refused');
  assert.equal(out.name, 'Collect 2026-11-14.zip');
});

test('progress counts finished files and never goes past the total', async () => {
  const s = await settledSet([[WB, 'mixed.xlsm', 'a.xlsm'], [WB, 'signed.xlsm', 'b.xlsm']]);
  const seen = [];
  s.subscribe((e) => e.type === 'progress' && seen.push(e.progress && e.progress.done));
  await startCollect({ session: s, pool: inProcessPool(), now: NOW, runId: 'r1' }).promise;
  assert.deepEqual(seen.filter((d) => d !== null), [0, 1, 2]);
});

test('a file the pool fails on becomes failed, the others still come out, and the run ends doneWithFailures', async () => {
  const s = await settledSet([[WB, 'mixed.xlsm', 'a.xlsm'], [WB, 'signed.xlsm', 'b.xlsm']]);
  const out = await startCollect({ session: s, pool: inProcessPool({ failIds: ['f0001'] }), now: NOW, runId: 'r1' }).promise;
  assert.equal(out.ok, true);
  assert.equal(s.state, 'doneWithFailures');
  assert.equal(s.file('f0001').badge, 'failed');
  const a = out.rows.filter((r) => r.file === 'a.xlsm');
  assert.deepEqual([a.length, a[0].verdict, a[0].reason_code], [1, 'failed', 'pool.failed']);
  assert.equal(names(out.bytes).some((n) => n.startsWith('b/')), true);
  assert.equal(names(out.bytes).some((n) => n.startsWith('a/')), false);
});

test('a worker that refuses a file it was sent is reported as failed with the code it gave', async () => {
  const s = await settledSet([[WB, 'mixed.xlsm', 'a.xlsm']]);
  const out = await startCollect({ session: s, pool: inProcessPool({ refuseIds: ['f0001'] }), now: NOW, runId: 'r1' }).promise;
  assert.deepEqual([out.rows[0].verdict, out.rows[0].reason_code, s.state], ['failed', 'file.notWorkbook', 'doneWithFailures']);
});

test('a file that failed to index appears in the report as refused', async () => {
  const s = await settledSet([[WB, 'mixed.xlsm', 'a.xlsm']]);
  s.addFiles([{ name: 'b.xlsx', relPath: 'b.xlsx', size: 1, lastModified: 1, file: new Blob([new Uint8Array(1)]) }]);
  s.failed('f0002', 'boom');
  const out = await startCollect({ session: s, pool: inProcessPool(), now: NOW, runId: 'r1' }).promise;
  const b = out.rows.find((r) => r.file === 'b.xlsx');
  assert.deepEqual([b.verdict, b.reason_code], ['refused', 'file.notWorkbook']);
  assert.equal(s.state, 'done');
});

test('cancel stops the run at once, asks the pool to cancel everything, and no output is produced', async () => {
  const s = await settledSet([[WB, 'mixed.xlsm', 'a.xlsm'], [WB, 'signed.xlsm', 'b.xlsm']]);
  const pool = inProcessPool({ hold: true });
  const run = startCollect({ session: s, pool, now: NOW, runId: 'r1' });
  await new Promise((r) => setTimeout(r, 0));
  run.cancel();
  assert.deepEqual([s.state, s.move, s.progress], ['ready', null, null]);
  assert.deepEqual(pool.cancelledWith, ['all']);
  assert.deepEqual(await run.promise, { cancelled: true });
  run.cancel();
  assert.deepEqual(pool.cancelledWith, ['all']);
});

test('a run can start again after a cancel', async () => {
  const s = await settledSet([[WB, 'mixed.xlsm', 'a.xlsm']]);
  const first = startCollect({ session: s, pool: inProcessPool({ hold: true }), now: NOW, runId: 'r1' });
  first.cancel();
  await first.promise;
  const second = await startCollect({ session: s, pool: inProcessPool(), now: NOW, runId: 'r2' }).promise;
  assert.equal(second.ok, true);
  assert.equal(s.state, 'done');
});

test('a run is refused while another move is active', async () => {
  const s = await settledSet([[WB, 'mixed.xlsm', 'a.xlsm']]);
  s.beginChoose();
  assert.throws(() => startCollect({ session: s, pool: inProcessPool(), now: NOW, runId: 'r1' }), /choose/);
});

test('outputs over the zip ceiling end the run without releasing anything and say why', async () => {
  const s = await settledSet([[WB, 'mixed.xlsm', 'a.xlsm']]);
  const out = await startCollect({ session: s, pool: inProcessPool(), now: NOW, runId: 'r1', ceilingBytes: 10 }).promise;
  assert.deepEqual([out.ok, out.code], [false, 'output.zipTooLarge']);
  assert.deepEqual([s.state, s.move], ['ready', null]);
});

const entriesExceptReport = async (zip) => {
  const pkg = new Package(readZip(zip));
  const out = {};
  for (const n of pkg.names()) if (n !== 'report.csv') out[n] = Array.from(await pkg.bytes(n)).join(',');
  return out;
};

test('the same time is used for every file and the same set gives the same outputs, apart from the timings in report.csv', async () => {
  const s = await settledSet([[WB, 'mixed.xlsm', 'a.xlsm'], [WB, 'signed.xlsm', 'b.xlsm']]);
  const a = await startCollect({ session: s, pool: inProcessPool(), now: NOW, runId: 'r1' }).promise;
  s.beginChoose();
  s.endChoose();
  const b = await startCollect({ session: s, pool: inProcessPool(), now: NOW, runId: 'r1' }).promise;
  assert.deepEqual(await entriesExceptReport(a.bytes), await entriesExceptReport(b.bytes));
  assert.deepEqual(names(a.bytes), names(b.bytes));
});
