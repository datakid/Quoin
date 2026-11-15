import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerPool, poolSize, budgetFor } from '../../src/app/pool.js';
import { openMessage, openedMessage, inspectMessage, inspectedMessage, refusedMessage, cancelMessage, cancelledMessage, progressMessage } from '../../src/batch/protocol.js';

const MIB = 1024 * 1024;

class FakeWorker {
  constructor(log) {
    this.posted = [];
    this.terminated = false;
    this.onmessage = null;
    this.onerror = null;
    log.push(this);
  }

  postMessage(m) {
    this.posted.push(m);
  }

  terminate() {
    this.terminated = true;
  }

  emit(m) {
    if (!this.terminated && this.onmessage) this.onmessage({ data: m });
  }

  forceEmit(m) {
    if (this.onmessage) this.onmessage({ data: m });
  }

  fail(message) {
    if (this.onerror) this.onerror({ message });
  }
}

function fakeTimers() {
  let now = 0;
  let next = 1;
  const pending = new Map();
  return {
    setTimeout: (fn, ms) => {
      const id = next++;
      pending.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout: (id) => pending.delete(id),
    advance(ms) {
      now += ms;
      for (const [id, t] of [...pending]) {
        if (t.at <= now) {
          pending.delete(id);
          t.fn();
        }
      }
    },
    count: () => pending.size
  };
}

const ref = (id, relPath = `${id}.xlsx`, size = 10) => ({ id, name: `${id}.xlsx`, relPath, size, lastModified: 1731542400000, file: new Blob([new Uint8Array(1)]) });
const open = (id, relPath, size) => openMessage(ref(id, relPath, size));
const index = (id) => ({ id, name: `${id}.xlsx`, relPath: `${id}.xlsx`, size: 10, status: 'ready' });
const tick = () => new Promise((r) => setTimeout(r, 0));

function make(extra = {}) {
  const workers = [];
  const timers = fakeTimers();
  const pool = new WorkerPool({ createWorker: () => new FakeWorker(workers), hardwareConcurrency: 8, deviceMemory: 8, budgetBytes: 1000, ackMs: 1000, timers, ...extra });
  return { pool, workers, timers };
}

const started = (workers) => workers.flatMap((w) => w.posted.map((m) => m.fileRef && m.fileRef.id)).filter(Boolean);

test('the pool size is min(4, max(1, cores - 1)) and at most 2 on a low-memory device', () => {
  assert.equal(poolSize(8, undefined), 4);
  assert.equal(poolSize(16, 8), 4);
  assert.equal(poolSize(5, undefined), 4);
  assert.equal(poolSize(4, undefined), 3);
  assert.equal(poolSize(2, undefined), 1);
  assert.equal(poolSize(1, undefined), 1);
  assert.equal(poolSize(undefined, undefined), 1);
  assert.equal(poolSize(16, 4), 2);
  assert.equal(poolSize(16, 2), 2);
  assert.equal(poolSize(4, 2), 2);
  assert.equal(poolSize(2, 2), 1);
});

test('the byte budget is 768 MiB, or 384 MiB when the device reports 4 GB or less', () => {
  assert.equal(budgetFor(undefined), 768 * MIB);
  assert.equal(budgetFor(8), 768 * MIB);
  assert.equal(budgetFor(4), 384 * MIB);
  assert.equal(budgetFor(2), 384 * MIB);
});

test('the pool defaults to the formula when no size or budget is injected', () => {
  const workers = [];
  const pool = new WorkerPool({ createWorker: () => new FakeWorker(workers), hardwareConcurrency: 4, deviceMemory: 4, timers: fakeTimers() });
  assert.deepEqual([pool.stats().size, pool.stats().budgetBytes], [2, 384 * MIB]);
});

test('workers are created on demand, up to the pool size, and a finished job frees its worker for the next', async () => {
  const { pool, workers } = make({ hardwareConcurrency: 3 });
  const results = ['a', 'b', 'c', 'd'].map((id) => pool.submit({ message: open(id) }));
  await tick();
  assert.equal(workers.length, 2);
  assert.deepEqual(started(workers), ['a', 'b']);
  assert.deepEqual([pool.stats().running, pool.stats().queued], [2, 2]);
  workers[0].emit(openedMessage('a', index('a')));
  assert.deepEqual(await results[0], { status: 'done', message: openedMessage('a', index('a')) });
  await tick();
  assert.deepEqual(workers[0].posted.map((m) => m.fileRef.id), ['a', 'c']);
  assert.deepEqual(workers[1].posted.map((m) => m.fileRef.id), ['b']);
  assert.equal(workers.length, 2);
});

test('jobs start in relPath order, not submission order', async () => {
  const { pool, workers } = make({ hardwareConcurrency: 2 });
  for (const p of ['b/x.xlsx', 'a/z.xlsx', 'c/y.xlsx', 'a/b.xlsx']) pool.submit({ message: open(p, p) });
  await tick();
  assert.deepEqual(started(workers), ['a/b.xlsx']);
  for (let i = 0; i < 3; i++) {
    const w = workers[0];
    const last = w.posted[w.posted.length - 1].fileRef.id;
    w.emit(openedMessage(last, index(last)));
    await tick();
  }
  assert.deepEqual(started(workers), ['a/b.xlsx', 'a/z.xlsx', 'b/x.xlsx', 'c/y.xlsx']);
});

test('byte-budget admission waits for the head of the queue and keeps the order', async () => {
  const { pool, workers } = make({ budgetBytes: 100 });
  pool.submit({ message: open('a', 'a', 60) });
  pool.submit({ message: open('b', 'b', 60) });
  pool.submit({ message: open('c', 'c', 30) });
  await tick();
  assert.deepEqual(started(workers), ['a']);
  assert.equal(pool.stats().inFlightBytes, 60);
  workers[0].emit(openedMessage('a', index('a')));
  await tick();
  assert.deepEqual(started(workers), ['a', 'b', 'c']);
  assert.equal(pool.stats().inFlightBytes, 90);
});

test('a job larger than the budget runs alone and is never refused for budget alone', async () => {
  const { pool, workers } = make({ budgetBytes: 100 });
  const big = pool.submit({ message: open('big', 'b', 500) });
  pool.submit({ message: open('small', 'c', 10) });
  await tick();
  assert.deepEqual(started(workers), ['big']);
  assert.equal(pool.stats().running, 1);
  workers[0].emit(openedMessage('big', index('big')));
  assert.equal((await big).status, 'done');
  await tick();
  assert.deepEqual(started(workers), ['big', 'small']);
});

test('an over-budget job waits until nothing else is running', async () => {
  const { pool, workers } = make({ budgetBytes: 100 });
  pool.submit({ message: open('small', 'a', 10) });
  pool.submit({ message: open('big', 'b', 500) });
  await tick();
  assert.deepEqual(started(workers), ['small']);
  workers[0].emit(openedMessage('small', index('small')));
  await tick();
  assert.deepEqual(started(workers), ['small', 'big']);
});

test('the estimate can be given by the caller instead of the file size', async () => {
  const { pool, workers } = make({ budgetBytes: 100 });
  pool.submit({ message: open('a', 'a', 10), estimate: 80 });
  pool.submit({ message: open('b', 'b', 10), estimate: 80 });
  await tick();
  assert.deepEqual(started(workers), ['a']);
});

test('a worker error fails that job, replaces the worker and the queue continues', async () => {
  const { pool, workers } = make({ hardwareConcurrency: 2 });
  const a = pool.submit({ message: open('a', 'a') });
  const b = pool.submit({ message: open('b', 'b') });
  await tick();
  workers[0].fail('boom');
  assert.deepEqual(await a, { status: 'failed', error: 'boom' });
  assert.equal(workers[0].terminated, true);
  await tick();
  assert.equal(workers.length, 2);
  assert.deepEqual(started(workers), ['a', 'b']);
  workers[1].emit(openedMessage('b', index('b')));
  assert.equal((await b).status, 'done');
});

test('a worker that cannot be created fails the job and the next job tries again', async () => {
  let calls = 0;
  const workers = [];
  const pool = new WorkerPool({
    createWorker: () => {
      calls++;
      if (calls === 1) throw new Error('no worker');
      return new FakeWorker(workers);
    },
    hardwareConcurrency: 2,
    deviceMemory: 8,
    timers: fakeTimers()
  });
  const a = pool.submit({ message: open('a', 'a') });
  const b = pool.submit({ message: open('b', 'b') });
  assert.deepEqual(await a, { status: 'failed', error: 'no worker' });
  await tick();
  assert.deepEqual(started(workers), ['b']);
  workers[0].emit(openedMessage('b', index('b')));
  assert.equal((await b).status, 'done');
});

test('an invalid message fails at once without reaching a worker', async () => {
  const { pool, workers } = make();
  const r = await pool.submit({ message: { type: 'open', fileRef: { id: 'x' } } });
  assert.equal(r.status, 'failed');
  assert.match(r.error, /fileRef/);
  assert.equal(workers.length, 0);
  assert.equal((await pool.submit({ message: cancelMessage('all') })).status, 'failed');
});

test('a refusal ends the job as done with the refusal message', async () => {
  const { pool, workers } = make();
  const r = pool.submit({ message: open('a', 'a') });
  await tick();
  workers[0].emit(refusedMessage('a', 'file.encrypted'));
  assert.deepEqual(await r, { status: 'done', message: refusedMessage('a', 'file.encrypted') });
});

test('inspect jobs complete on inspected', async () => {
  const { pool, workers } = make();
  const r = pool.submit({ message: inspectMessage(ref('a'), ['nonEmpty']) });
  await tick();
  workers[0].emit(inspectedMessage('a', index('a')));
  assert.equal((await r).message.type, 'inspected');
});

test('replies for another file or with no running job are ignored', async () => {
  const { pool, workers } = make();
  const r = pool.submit({ message: open('a', 'a') });
  await tick();
  workers[0].emit(openedMessage('zzz', index('zzz')));
  assert.equal(pool.stats().running, 1);
  workers[0].emit(openedMessage('a', index('a')));
  assert.equal((await r).status, 'done');
  workers[0].emit(openedMessage('a', index('a')));
  assert.equal(pool.stats().running, 0);
});

test('progress messages go to the job and do not end it', async () => {
  const { pool, workers } = make();
  const seen = [];
  const r = pool.submit({ message: open('a', 'a'), onProgress: (m) => seen.push(m.pct) });
  await tick();
  workers[0].emit(progressMessage('a', 'u1', 'open', 40));
  workers[0].emit(progressMessage('other', 'u1', 'open', 99));
  assert.deepEqual(seen, [40]);
  assert.equal(pool.stats().running, 1);
  workers[0].emit(openedMessage('a', index('a')));
  await r;
});

test('cancelling a queued job removes it and it never reaches a worker', async () => {
  const { pool, workers } = make({ hardwareConcurrency: 2 });
  pool.submit({ message: open('a', 'a') });
  const b = pool.submit({ message: open('b', 'b') });
  await tick();
  pool.cancel('b');
  assert.deepEqual(await b, { status: 'cancelled' });
  workers[0].emit(openedMessage('a', index('a')));
  await tick();
  assert.deepEqual(started(workers), ['a']);
});

test('cancelling a running job asks the worker and a cancelled reply keeps the worker', async () => {
  const { pool, workers, timers } = make();
  const a = pool.submit({ message: open('a', 'a') });
  const b = pool.submit({ message: open('b', 'b') });
  await tick();
  pool.cancel('a');
  assert.deepEqual(workers[0].posted.at(-1), cancelMessage('a'));
  assert.equal(timers.count(), 1);
  workers[0].emit(cancelledMessage('a'));
  assert.deepEqual(await a, { status: 'cancelled' });
  assert.equal(workers[0].terminated, false);
  assert.equal(timers.count(), 0);
  await tick();
  assert.equal(workers.length, 2);
  workers[1].emit(openedMessage('b', index('b')));
  assert.equal((await b).status, 'done');
});

test('a worker that does not acknowledge within 1000 ms is terminated and replaced', async () => {
  const { pool, workers, timers } = make({ hardwareConcurrency: 2 });
  const a = pool.submit({ message: open('a', 'a') });
  await tick();
  pool.cancel('a');
  timers.advance(999);
  assert.equal(workers[0].terminated, false);
  timers.advance(1);
  assert.deepEqual(await a, { status: 'cancelled' });
  assert.equal(workers[0].terminated, true);
  assert.equal(pool.stats().running, 0);
  const b = pool.submit({ message: open('b', 'b') });
  await tick();
  assert.equal(workers.length, 2);
  workers[0].forceEmit(openedMessage('a', index('a')));
  assert.equal(pool.stats().running, 1);
  workers[1].emit(openedMessage('b', index('b')));
  assert.equal((await b).status, 'done');
});

test('a result that arrives after a cancel is discarded and reported as cancelled', async () => {
  const { pool, workers } = make();
  const a = pool.submit({ message: open('a', 'a') });
  await tick();
  pool.cancel('a');
  workers[0].emit(openedMessage('a', index('a')));
  assert.deepEqual(await a, { status: 'cancelled' });
});

test('cancel all cancels queued and running jobs', async () => {
  const { pool, workers } = make({ hardwareConcurrency: 3 });
  const rs = ['a', 'b', 'c', 'd'].map((id) => pool.submit({ message: open(id, id) }));
  await tick();
  pool.cancel('all');
  assert.equal(workers[0].posted.at(-1).type, 'cancel');
  assert.equal(workers[1].posted.at(-1).type, 'cancel');
  workers[0].emit(cancelledMessage('a'));
  workers[1].emit(cancelledMessage('b'));
  assert.deepEqual((await Promise.all(rs)).map((r) => r.status), ['cancelled', 'cancelled', 'cancelled', 'cancelled']);
  assert.deepEqual([pool.stats().running, pool.stats().queued, pool.stats().inFlightBytes], [0, 0, 0]);
});

test('lease gives an exclusive worker that batch jobs never use', async () => {
  const { pool, workers } = make({ hardwareConcurrency: 2 });
  const lease = pool.lease();
  assert.equal(workers.length, 1);
  assert.equal(lease.worker, workers[0]);
  const a = pool.submit({ message: open('a', 'a') });
  await tick();
  assert.equal(workers.length, 2);
  assert.deepEqual(workers[0].posted, []);
  assert.deepEqual(started(workers), ['a']);
  workers[1].emit(openedMessage('a', index('a')));
  assert.equal((await a).status, 'done');
});

test('terminating a leased worker does not touch other jobs and the pool replaces it', async () => {
  const { pool, workers } = make({ hardwareConcurrency: 3 });
  const a = pool.submit({ message: open('a', 'a') });
  await tick();
  const lease = pool.lease();
  assert.notEqual(lease.worker, workers[0]);
  lease.worker.terminate();
  lease.release({ terminated: true });
  assert.equal(workers[0].terminated, false);
  assert.equal(pool.stats().leased, 0);
  workers[0].emit(openedMessage('a', index('a')));
  assert.equal((await a).status, 'done');
  const b = pool.submit({ message: open('b', 'b') });
  await tick();
  assert.equal(started(workers).includes('b'), true);
  const holder = workers.find((w) => w.posted.some((m) => m.fileRef && m.fileRef.id === 'b'));
  assert.equal(holder.terminated, false);
  holder.emit(openedMessage('b', index('b')));
  assert.equal((await b).status, 'done');
});

test('a released lease returns its worker to the pool', async () => {
  const { pool, workers } = make({ hardwareConcurrency: 2 });
  const lease = pool.lease();
  lease.release();
  lease.release();
  assert.equal(pool.stats().leased, 0);
  const a = pool.submit({ message: open('a', 'a') });
  await tick();
  assert.equal(workers.length, 1);
  assert.deepEqual(started(workers), ['a']);
  workers[0].emit(openedMessage('a', index('a')));
  assert.equal((await a).status, 'done');
});

test('destroy terminates every worker and cancels everything', async () => {
  const { pool, workers } = make({ hardwareConcurrency: 2 });
  const a = pool.submit({ message: open('a', 'a') });
  const b = pool.submit({ message: open('b', 'b') });
  await tick();
  const lease = pool.lease();
  pool.destroy();
  assert.deepEqual([(await a).status, (await b).status], ['cancelled', 'cancelled']);
  assert.equal(workers.every((w) => w.terminated), true);
  assert.equal(lease.worker.terminated, true);
  assert.deepEqual((await pool.submit({ message: open('c', 'c') })).status, 'cancelled');
});
