import test from 'node:test';
import assert from 'node:assert/strict';
import { Runner } from '../../src/app/runner.js';
import { WorkerPool } from '../../src/app/pool.js';
import { openMessage, openedMessage } from '../../src/batch/protocol.js';

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

  fail(message) {
    if (this.onerror) this.onerror({ message });
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const ref = (id) => ({ id, name: `${id}.xlsx`, relPath: `${id}.xlsx`, size: 10, lastModified: 1, file: new Blob([new Uint8Array(1)]) });

function make() {
  const workers = [];
  const pool = new WorkerPool({ createWorker: () => new FakeWorker(workers), hardwareConcurrency: 4, deviceMemory: 8 });
  return { pool, workers, runner: new Runner(pool) };
}

test('a runner takes a worker from the pool on first use and not before', () => {
  const { pool, workers } = make();
  assert.deepEqual([workers.length, pool.stats().leased], [0, 0]);
});

test('the first request leases one worker and posts to it, and replies resolve the request', async () => {
  const { pool, workers, runner } = make();
  const pending = runner.rowsOf('r1', 0, 5);
  assert.deepEqual([workers.length, pool.stats().leased], [1, 1]);
  const sent = workers[0].posted[0];
  assert.deepEqual([sent.type, sent.start, sent.count, sent.resultId], ['rows', 0, 5, 'r1']);
  workers[0].emit({ id: sent.id, type: 'rows', rows: [[1]] });
  assert.deepEqual(await pending, { rows: [[1]], evicted: false });
});

test('later requests reuse the same leased worker', () => {
  const { pool, workers, runner } = make();
  runner.rowsOf('r1', 0, 5);
  runner.rowsOf('r1', 5, 5);
  assert.deepEqual([workers.length, pool.stats().leased, workers[0].posted.length], [1, 1, 2]);
});

test('stop terminates the leased worker, returns the lease, and the next use leases a fresh one', async () => {
  const { pool, workers, runner } = make();
  const first = runner.rowsOf('r1', 0, 5);
  runner.stop({ type: 'result', status: 'cancelled' });
  assert.equal(workers[0].terminated, true);
  assert.deepEqual([pool.stats().leased, pool.stats().workers], [0, 0]);
  assert.equal(runner.generation, 1);
  assert.deepEqual((await first).rows, []);
  runner.rowsOf('r1', 0, 5);
  assert.deepEqual([workers.length, pool.stats().leased], [2, 1]);
  assert.equal(workers[1].terminated, false);
});

test('terminating the leased worker does not affect a batch job running on another worker', async () => {
  const { pool, workers, runner } = make();
  const job = pool.submit({ message: openMessage(ref('a')) });
  await tick();
  runner.rowsOf('r1', 0, 5);
  assert.equal(workers.length, 2);
  runner.cancel();
  assert.equal(workers[1].terminated, true);
  assert.equal(workers[0].terminated, false);
  assert.equal(pool.stats().running, 1);
  workers[0].emit(openedMessage('a', { id: 'a', status: 'ready' }));
  assert.equal((await job).status, 'done');
});

test('a worker error releases the lease and the next use leases a fresh worker', async () => {
  const { pool, workers, runner } = make();
  const pending = runner.rowsOf('r1', 0, 5);
  workers[0].fail('crash');
  assert.deepEqual((await pending).rows, []);
  assert.deepEqual([pool.stats().leased, pool.stats().workers], [0, 0]);
  runner.rowsOf('r1', 0, 5);
  assert.equal(workers.length, 2);
});

test('two runners hold two separate workers', () => {
  const { pool, workers, runner } = make();
  const other = new Runner(pool);
  runner.rowsOf('r1', 0, 5);
  other.rowsOf('r2', 0, 5);
  assert.deepEqual([workers.length, pool.stats().leased], [2, 2]);
  runner.cancel();
  assert.deepEqual([workers[0].terminated, workers[1].terminated, pool.stats().leased], [true, false, 1]);
});
