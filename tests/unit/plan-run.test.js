import test from 'node:test';
import assert from 'node:assert/strict';
import { startPlanRun } from '../../src/app/plan-run.js';
import { createVariantTextLoader } from '../../src/app/variant-text.js';
import { SetSession } from '../../src/app/set-session.js';
import { indexWorkbook } from '../../src/batch/index/file-index.js';
import { runFilePlan } from '../../src/batch/execute/run-file.js';
import { appliedMessage, refusedMessage } from '../../src/batch/protocol.js';
import { parseRecipe } from '../../src/batch/recipe/recipe.js';
import { fixture, generated } from './helpers.js';

const NOW = '2026-11-14T10:00:00.000Z';
const NEW_M = 'let\n    Source = 2\nin\n    Source';

const recipeOf = (json) => parseRecipe(JSON.stringify(json)).recipe;
const injectReplace = () => recipeOf({ recipe: 'inject', v: 1, inject: { target: 'query', op: 'replace', match: 'name', name: 'StudentResults', source: 'inline', text: NEW_M, refreshOnLoad: false } });
const moduleReplace = () => recipeOf({ recipe: 'inject', v: 1, inject: { target: 'module', op: 'replace', match: 'name', name: 'Module1', source: 'inline', text: 'Sub A()\r\nEnd Sub\r\n', refreshOnLoad: false } });

async function settledSet(specs) {
  const s = new SetSession();
  const bytesById = new Map();
  s.addFiles(specs.map(([bytes, relPath]) => ({ name: relPath.split('/').pop(), relPath, size: bytes.length, lastModified: 1, file: new Blob([bytes]) })));
  for (const f of s.list()) {
    const bytes = new Uint8Array(await f.file.arrayBuffer());
    bytesById.set(f.id, bytes);
    const index = await indexWorkbook(bytes, { id: f.id, name: f.name, relPath: f.relPath, size: f.size });
    if (index.status === 'ready') s.indexed(f.id, index);
    else s.refused(f.id, index.refused.code);
  }
  return s;
}

function inProcessPool({ hold = false, failIds = [], delayFor = () => 0, mutate = null } = {}) {
  const pending = [];
  const pool = {
    submitted: [],
    cancelledWith: [],
    async submit({ message }) {
      const id = message.fileRef.id;
      pool.submitted.push({ id, type: message.type, recipe: message.options.recipe ? message.options.recipe.recipe : 'collect', dryRun: message.options.dryRun });
      if (hold) return new Promise((resolve) => pending.push(resolve));
      const wait = delayFor(id);
      if (wait) await new Promise((r) => setTimeout(r, wait));
      if (failIds.includes(id)) return { status: 'failed', error: 'crash' };
      const bytes = new Uint8Array(await message.fileRef.file.arrayBuffer());
      const meta = { id, name: message.fileRef.name, relPath: message.fileRef.relPath, size: message.fileRef.size };
      let result = await runFilePlan(bytes, meta, message.filePlan, message.options);
      if (mutate) result = mutate(result, message);
      return { status: 'done', message: appliedMessage(id, result) };
    },
    cancel(target) {
      pool.cancelledWith.push(target);
      while (pending.length) pending.shift()({ status: 'cancelled' });
    }
  };
  return pool;
}

const pq = () => fixture('pq_simple.xlsx');
const noQuery = () => generated('mixed.xlsm');

const preview = (args) => startPlanRun({ mode: 'preview', now: NOW, runId: 'r1', ...args });

test('preview shows what would change, keeps each file hash, and drops the bytes', async () => {
  const session = await settledSet([[pq(), 'a/one.xlsx'], [pq(), 'b/two.xlsx'], [noQuery(), 'c/none.xlsm']]);
  const pool = inProcessPool();
  const out = await preview({ session, pool, recipe: injectReplace() }).promise;
  assert.equal(out.ok, true);
  assert.deepEqual(out.rows.map((r) => [r.file, r.verdict]), [['one.xlsx', 'changed'], ['two.xlsx', 'changed'], ['none.xlsm', 'skipped']]);
  assert.equal(out.rows[2].reason_code, 'skip.notApplicable');
  assert.deepEqual(out.counts, { changed: 2, unchanged: 0, skipped: 1, refused: 0, failed: 0, cancelled: 0 });
  for (const id of ['f0001', 'f0002']) assert.match(out.hashes.get(id), /^[0-9a-f]{64}$/);
  assert.equal(out.hashes.has('f0003'), false);
  for (const v of out.perFile.values()) assert.equal(v.bytes === null, true, 'preview must not keep bytes');
  assert.equal(session.state, 'ready');
  assert.equal(session.move, null);
  assert.deepEqual(pool.submitted.map((s) => s.dryRun), [true, true, true]);
});

test('preview does not mark a file as failed in the set', async () => {
  const session = await settledSet([[pq(), 'a/one.xlsx'], [pq(), 'b/two.xlsx']]);
  const pool = inProcessPool({ failIds: ['f0002'] });
  const out = await preview({ session, pool, recipe: injectReplace() }).promise;
  assert.deepEqual(out.rows.map((r) => [r.file, r.verdict, r.reason_code]), [['one.xlsx', 'changed', ''], ['two.xlsx', 'failed', 'pool.failed']]);
  assert.equal(out.counts.failed, 1);
  assert.equal(session.file('f0002').badge, 'ready');
});

test('rows come back in plan order whatever order the workers finish in', async () => {
  const session = await settledSet([[pq(), 'a/one.xlsx'], [pq(), 'b/two.xlsx'], [pq(), 'c/three.xlsx']]);
  const pool = inProcessPool({ delayFor: (id) => ({ f0001: 40, f0002: 20, f0003: 0 })[id] });
  const out = await preview({ session, pool, recipe: injectReplace() }).promise;
  assert.deepEqual(out.rows.map((r) => r.file), ['one.xlsx', 'two.xlsx', 'three.xlsx']);
});

test('progress counts finished files up to the total', async () => {
  const session = await settledSet([[pq(), 'a/one.xlsx'], [pq(), 'b/two.xlsx']]);
  const seen = [];
  await preview({ session, pool: inProcessPool(), recipe: injectReplace(), onProgress: (done, total) => seen.push([done, total]) }).promise;
  assert.deepEqual(seen, [[1, 2], [2, 2]]);
});

test('a plan with errors is refused before anything is sent and the set stays ready', async () => {
  const session = await settledSet([[pq(), 'a/one.xlsx']]);
  const pool = inProcessPool();
  const recipe = recipeOf({ recipe: 'inject', v: 1, inject: { target: 'query', op: 'add', match: 'pattern', name: 'Stu*', source: 'inline', text: NEW_M, refreshOnLoad: false } });
  const out = await preview({ session, pool, recipe }).promise;
  assert.equal(out.ok, false);
  assert.equal(out.code, 'plan.invalid');
  assert.ok(out.errors.some((e) => e.code === 'recipe.patternAdd'));
  assert.equal(pool.submitted.length, 0);
  assert.equal(session.state, 'ready');
});

test('cancelling a preview stops the pool, resolves as cancelled and returns the set to ready', async () => {
  const session = await settledSet([[pq(), 'a/one.xlsx'], [pq(), 'b/two.xlsx']]);
  const pool = inProcessPool({ hold: true });
  const run = preview({ session, pool, recipe: injectReplace() });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(session.state, 'previewing');
  run.cancel();
  const out = await run.promise;
  assert.deepEqual(out, { cancelled: true });
  assert.deepEqual(pool.cancelledWith, ['all']);
  assert.equal(session.state, 'ready');
  assert.equal(session.move, null);
});

test('plan equals run: a run after a preview with the same frozen time gives the same hash for every file', async () => {
  const session = await settledSet([[pq(), 'a/one.xlsx'], [pq(), 'b/two.xlsx'], [noQuery(), 'c/none.xlsm']]);
  const pool = inProcessPool();
  const recipe = injectReplace();
  const previewed = await preview({ session, pool, recipe }).promise;
  const ran = await startPlanRun({ mode: 'run', session, pool, recipe, now: NOW, runId: 'r1', preview: previewed }).promise;
  assert.equal(ran.ok, true);
  for (const [id, hash] of previewed.hashes) {
    assert.equal(ran.hashes.get(id), hash, id);
    assert.ok(ran.perFile.get(id).bytes instanceof Uint8Array);
  }
  assert.deepEqual(ran.rows.map((r) => [r.file, r.verdict]), previewed.rows.map((r) => [r.file, r.verdict]));
  assert.equal(session.state, 'done');
  assert.deepEqual(pool.submitted.map((s) => s.dryRun), [true, true, true, false, false, false]);
});

test('a run uses the time frozen by the preview even when it is started later', async () => {
  const session = await settledSet([[pq(), 'a/one.xlsx']]);
  const pool = inProcessPool();
  const recipe = injectReplace();
  const previewed = await preview({ session, pool, recipe }).promise;
  const ran = await startPlanRun({ mode: 'run', session, pool, recipe, now: '2027-03-03T03:03:03.000Z', runId: 'r1', preview: previewed }).promise;
  assert.equal(ran.ok, true);
  assert.equal(ran.now, NOW);
  assert.equal(ran.hashes.get('f0001'), previewed.hashes.get('f0001'));
});

test('a run is refused as diverged when a file gives different bytes than it did in the preview', async () => {
  const session = await settledSet([[pq(), 'a/one.xlsx'], [pq(), 'b/two.xlsx']]);
  const recipe = injectReplace();
  const previewed = await preview({ session, pool: inProcessPool(), recipe }).promise;
  const tampering = inProcessPool({
    mutate: (result) => {
      const bytes = new Uint8Array(result.bytes);
      bytes[bytes.length - 1] ^= 1;
      return { ...result, bytes, sha256: '0'.repeat(64) };
    }
  });
  const ran = await startPlanRun({ mode: 'run', session, pool: tampering, recipe, now: NOW, runId: 'r1', preview: previewed }).promise;
  assert.equal(ran.ok, false);
  assert.equal(ran.code, 'plan.diverged');
  assert.deepEqual(ran.files, ['f0001', 'f0002']);
  assert.equal(session.state, 'ready');
});

test('a run is refused as stale when the set changed after the preview, and nothing is sent', async () => {
  const session = await settledSet([[pq(), 'a/one.xlsx']]);
  const pool = inProcessPool();
  const recipe = injectReplace();
  const previewed = await preview({ session, pool, recipe }).promise;
  const before = pool.submitted.length;
  session.addFiles([{ name: 'late.xlsx', relPath: 'z/late.xlsx', size: 3, lastModified: 2, file: new Blob([pq()]) }]);
  const late = session.list().find((f) => f.name === 'late.xlsx');
  session.indexed(late.id, await indexWorkbook(pq(), { id: late.id, name: late.name, relPath: late.relPath, size: 3 }));
  const ran = await startPlanRun({ mode: 'run', session, pool, recipe, now: NOW, runId: 'r1', preview: previewed }).promise;
  assert.equal(ran.ok, false);
  assert.equal(ran.code, 'plan.stale');
  assert.equal(pool.submitted.length, before);
  assert.equal(session.state, 'ready');
});

test('a run needs a preview', () => {
  const session = new SetSession();
  assert.throws(() => startPlanRun({ mode: 'run', session, pool: inProcessPool(), recipe: injectReplace(), now: NOW, runId: 'r1' }), /preview/);
});

test('only inject, replace and align can be previewed, and the mode must be known', () => {
  const session = new SetSession();
  const transform = recipeOf({ recipe: 'transform', v: 1, query: { source: 'inline', m: 'let x = 1 in x' }, output: { mode: 'newFile' } });
  assert.throws(() => startPlanRun({ mode: 'preview', session, pool: inProcessPool(), recipe: transform, now: NOW, runId: 'r1' }), /transform/);
  assert.throws(() => startPlanRun({ mode: 'dry', session, pool: inProcessPool(), recipe: injectReplace(), now: NOW, runId: 'r1' }), /mode/);
});

test('a signed project is previewed as changed with its signature marked removed, and a run needs the set to be confirmed', async () => {
  const session = await settledSet([[generated('signed.xlsm'), 'a/signed.xlsm'], [generated('mixed.xlsm'), 'b/plain.xlsm']]);
  const pool = inProcessPool();
  const recipe = moduleReplace();
  const previewed = await preview({ session, pool, recipe }).promise;
  assert.equal(previewed.signedCount, 1);
  assert.deepEqual(previewed.rows.map((r) => [r.file, r.verdict, r.signature_removed]), [['signed.xlsm', 'changed', true], ['plain.xlsm', 'changed', false]]);
  const before = pool.submitted.length;
  const refused = await startPlanRun({ mode: 'run', session, pool, recipe, now: NOW, runId: 'r1', preview: previewed }).promise;
  assert.deepEqual([refused.ok, refused.code, refused.count], [false, 'vba.confirmNeeded', 1]);
  assert.equal(pool.submitted.length, before);
  assert.equal(session.state, 'ready');
  const ran = await startPlanRun({ mode: 'run', session, pool, recipe, now: NOW, runId: 'r1', preview: previewed, confirmSignatures: true }).promise;
  assert.equal(ran.ok, true);
  for (const [id, hash] of previewed.hashes) assert.equal(ran.hashes.get(id), hash, id);
});

test('a file that crashes during the run is a failed row and a failed badge, the others still land, and it is not a divergence', async () => {
  const session = await settledSet([[pq(), 'a/one.xlsx'], [pq(), 'b/two.xlsx']]);
  const recipe = injectReplace();
  const previewed = await preview({ session, pool: inProcessPool(), recipe }).promise;
  const ran = await startPlanRun({ mode: 'run', session, pool: inProcessPool({ failIds: ['f0002'] }), recipe, now: NOW, runId: 'r1', preview: previewed }).promise;
  assert.equal(ran.ok, true);
  assert.deepEqual(ran.rows.map((r) => [r.file, r.verdict, r.reason_code]), [['one.xlsx', 'changed', ''], ['two.xlsx', 'failed', 'pool.failed']]);
  assert.equal(ran.hashes.get('f0001'), previewed.hashes.get('f0001'));
  assert.equal(ran.hashes.has('f0002'), false);
  assert.equal(session.file('f0002').badge, 'failed');
  assert.equal(session.state, 'doneWithFailures');
});

test('align previews against the text of the chosen version read from its file', async () => {
  const original = pq();
  const edited = (await runFilePlan(original, { id: 'f0001', name: 'x.xlsx', relPath: 'x.xlsx', size: original.length }, await planOfInject(original), { now: NOW, dryRun: false, limits: { timeoutMs: 30000, maxRows: 1000000 }, culture: 'en-US', runId: 'seed', recipe: injectReplace() })).bytes;
  const session = await settledSet([[original, 'a/original.xlsx'], [edited, 'b/edited.xlsx']]);
  const source = session.index('f0001').queries.find((q) => q.name === 'StudentResults');
  const recipe = recipeOf({ recipe: 'align', v: 1, align: { target: 'query', name: 'StudentResults', hash: source.hash } });
  const pool = inProcessPool();
  const loadAlignText = createVariantTextLoader({ pool, session, now: NOW, runId: 'r1' });
  const out = await preview({ session, pool, recipe, loadAlignText }).promise;
  assert.equal(out.ok, true);
  assert.deepEqual(out.rows.map((r) => [r.file, r.verdict]), [['original.xlsx', 'unchanged'], ['edited.xlsx', 'changed']]);
});

async function planOfInject(bytes) {
  const { resolvePlan } = await import('../../src/batch/resolve/resolve.js');
  const index = await indexWorkbook(bytes, { id: 'f0001', name: 'x.xlsx', relPath: 'x.xlsx', size: bytes.length });
  return resolvePlan(injectReplace(), [index], { now: NOW }).files[0];
}

test('a preview started while another preview is going throws at the call and leaves the first one alone', async () => {
  const session = await settledSet([[pq(), 'a.xlsx']]);
  const pool = inProcessPool({ hold: true });
  const first = startPlanRun({ mode: 'preview', session, pool, recipe: injectReplace(), now: NOW, runId: 'r1' });
  assert.throws(() => startPlanRun({ mode: 'preview', session, pool, recipe: injectReplace(), now: NOW, runId: 'r2' }), /cannot preview/);
  assert.equal(session.state, 'previewing');
  first.cancel();
  await first.promise;
  assert.equal(session.state, 'ready');
});
