import test from 'node:test';
import assert from 'node:assert/strict';
import { startPlanRun, previewSupport } from '../../src/app/plan-run.js';
import { buildPlanOutput } from '../../src/app/outputs.js';
import { createVariantTextLoader } from '../../src/app/variant-text.js';
import { SetSession } from '../../src/app/set-session.js';
import { indexWorkbook } from '../../src/batch/index/file-index.js';
import { runFilePlan } from '../../src/batch/execute/run-file.js';
import { appliedMessage, refusedMessage } from '../../src/batch/protocol.js';
import { parseRecipe } from '../../src/batch/recipe/recipe.js';
import { S } from '../../src/ui/strings.js';
import { openWorkbook } from '../../src/core/workbook.js';
import { readUsedGrid } from '../../src/core/cells.js';
import { combineOutputs } from '../../src/batch/execute/combine.js';
import { executeFile } from '../../src/batch/execute/index.js';
import { resolvePlan } from '../../src/batch/resolve/resolve.js';
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
    async submit({ message, estimate }) {
      const id = message.fileRef.id;
      pool.submitted.push({ id, type: message.type, recipe: message.options.recipe ? message.options.recipe.recipe : 'collect', dryRun: message.options.dryRun, estimate });
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
  assert.deepEqual(out.counts, { changed: 2, unchanged: 0, skipped: 1, refused: 0, failed: 0, cancelled: 0, 'not-released': 0 });
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

test('a file whose run hash differs from its preview is not released, the rest of the batch is, and the run is marked as having a defect', async () => {
  const session = await settledSet([[pq(), 'a/one.xlsx'], [pq(), 'b/two.xlsx']]);
  const recipe = injectReplace();
  const previewed = await preview({ session, pool: inProcessPool(), recipe }).promise;
  const tampering = inProcessPool({
    mutate: (result, message) => {
      if (message.fileRef.id !== 'f0002') return result;
      const bytes = new Uint8Array(result.bytes);
      bytes[bytes.length - 1] ^= 1;
      return { ...result, bytes, sha256: '0'.repeat(64) };
    }
  });
  const ran = await startPlanRun({ mode: 'run', session, pool: tampering, recipe, now: NOW, runId: 'r1', preview: previewed }).promise;
  assert.equal(ran.ok, true);
  assert.equal(ran.defect, true);
  assert.deepEqual(ran.diverged, ['f0002']);
  assert.ok(ran.perFile.get('f0001').bytes instanceof Uint8Array);
  assert.equal(ran.perFile.get('f0002').bytes, null);
  assert.equal(ran.hashes.has('f0002'), false);
  assert.deepEqual(ran.rows.map((r) => [r.file, r.verdict, r.reason_code]), [['one.xlsx', 'changed', ''], ['two.xlsx', 'not-released', 'verify.planDrift']]);
  assert.equal(ran.counts['not-released'], 1);
  assert.equal(session.file('f0002').error, 'verify.planDrift');
  assert.equal(session.state, 'doneWithFailures');
});

test('a clean run is not marked as having a defect', async () => {
  const session = await settledSet([[pq(), 'a/one.xlsx']]);
  const pool = inProcessPool();
  const recipe = injectReplace();
  const previewed = await preview({ session, pool, recipe }).promise;
  const ran = await startPlanRun({ mode: 'run', session, pool, recipe, now: NOW, runId: 'r1', preview: previewed }).promise;
  assert.equal(ran.defect, false);
  assert.deepEqual(ran.diverged, []);
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

const transformOf = (output, extra = {}) => recipeOf({ recipe: 'transform', v: 1, scope: { type: 'tables', match: 'all' }, query: { source: 'inline', m: 'Excel.CurrentWorkbook(){[Name="{unit.name}"]}[Content]' }, output, ...extra });

test('only inject, replace, align and a transform that writes a new file per unit, a new sheet in a copy or one combined workbook can be previewed, and the mode must be known', () => {
  const session = new SetSession();
  for (const [recipe, why] of [[transformOf({ mode: 'inPlace', range: 'A1' }), /transform/], [transformOf({ mode: 'newFile' }, { compute: 'excel' }), /transform/]]) {
    assert.throws(() => startPlanRun({ mode: 'preview', session, pool: inProcessPool(), recipe, now: NOW, runId: 'r1' }), why);
  }
  assert.throws(() => startPlanRun({ mode: 'dry', session, pool: inProcessPool(), recipe: injectReplace(), now: NOW, runId: 'r1' }), /mode/);
});

test('previewSupport says why a recipe cannot be previewed', () => {
  assert.deepEqual(previewSupport(injectReplace()), { ok: true });
  assert.deepEqual(previewSupport(transformOf({ mode: 'newFile' })), { ok: true });
  assert.deepEqual(previewSupport(transformOf({ mode: 'newSheet' })), { ok: true });
  assert.deepEqual(previewSupport(transformOf({ mode: 'combined' })), { ok: true });
  assert.deepEqual(previewSupport(transformOf({ mode: 'inPlace', range: 'A1' })), { ok: false, why: 'output', mode: 'inPlace' });
  assert.deepEqual(previewSupport(transformOf({ mode: 'newFile' }, { compute: 'excel' })), { ok: false, why: 'compute' });
  assert.deepEqual(previewSupport(recipeOf({ recipe: 'collect', v: 1 })), { ok: false, why: 'kind' });
});

test('a transform preview lists a row per unit with the file it would write, keeps a hash per file, and drops every byte', async () => {
  const session = await settledSet([[pq(), 'a/one.xlsx'], [noQuery(), 'c/none.xlsm']]);
  const pool = inProcessPool();
  const out = await preview({ session, pool, recipe: transformOf({ mode: 'newFile' }) }).promise;
  assert.equal(out.ok, true);
  assert.deepEqual(out.rows.map((r) => [r.file, r.unit, r.verdict, r.output]), [['one.xlsx', 'StudentNames', 'changed', 'one__StudentNames.xlsx'], ['one.xlsx', 'StudentResults', 'changed', 'one__StudentResults.xlsx'], ['none.xlsm', 'FinalTable', 'changed', 'none__FinalTable.xlsx'], ['none.xlsm', 'RawInput', 'changed', 'none__RawInput.xlsx']]);
  assert.match(out.hashes.get('f0001'), /^[0-9a-f]{64}$/);
  const held = out.perFile.get('f0001');
  assert.equal(held.bytes, null);
  assert.equal(held.outputs.length, 2);
  for (const o of held.outputs) assert.deepEqual([o.bytes === undefined, /^[0-9a-f]{64}$/.test(o.sha256)], [true, true]);
  assert.deepEqual(pool.submitted.map((s) => [s.recipe, s.dryRun]), [['transform', true], ['transform', true]]);
  assert.equal(out.counts.changed, 4);
  assert.equal(out.perFile.get('f0002').outputs.length, 2);
});

async function transformPair(mutate = null) {
  const session = await settledSet([[pq(), 'a/one.xlsx'], [pq(), 'b/two.xlsx']]);
  const recipe = transformOf({ mode: 'newFile' });
  const previewed = await preview({ session, pool: inProcessPool(), recipe }).promise;
  const pool = inProcessPool({ mutate });
  const run = await startPlanRun({ mode: 'run', session, pool, recipe, now: NOW, runId: 'r2', preview: previewed, build: (result) => buildPlanOutput(result) }).promise;
  return { previewed, run };
}

test('a transform run writes the very files the preview described', async () => {
  const { previewed, run } = await transformPair();
  assert.equal(run.ok, true);
  assert.equal(run.defect, false);
  assert.deepEqual(run.output.files, ['a/one__StudentNames.xlsx', 'a/one__StudentResults.xlsx', 'b/two__StudentNames.xlsx', 'b/two__StudentResults.xlsx']);
  for (const [id, held] of run.perFile) {
    assert.equal(run.hashes.get(id), previewed.hashes.get(id));
    for (const o of held.outputs) assert.deepEqual([o.bytes instanceof Uint8Array, o.bytes.length > 0], [true, true]);
  }
  assert.deepEqual(run.rows.map((r) => r.verdict), ['changed', 'changed', 'changed', 'changed']);
});

test('a transform output that differs from its preview is not released and the run is flagged', async () => {
  const flip = (result) => {
    if (!result.outputs || result.fileId !== 'f0002') return result;
    return { ...result, outputs: result.outputs.map((o, i) => (i === 0 ? { ...o, sha256: 'f'.repeat(64) } : o)) };
  };
  const { run } = await transformPair(flip);
  assert.equal(run.ok, true);
  assert.equal(run.defect, true);
  assert.deepEqual(run.diverged, ['f0002']);
  assert.deepEqual(run.output.files, ['a/one__StudentNames.xlsx', 'a/one__StudentResults.xlsx']);
  assert.deepEqual(run.output.rows.map((r) => [r.file, r.verdict, r.reason_code, r.output]), [
    ['one.xlsx', 'changed', '', 'a/one__StudentNames.xlsx'],
    ['one.xlsx', 'changed', '', 'a/one__StudentResults.xlsx'],
    ['two.xlsx', 'not-released', 'verify.planDrift', ''],
    ['two.xlsx', 'not-released', 'verify.planDrift', '']
  ]);
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

test('align previews a module against the text of the chosen version read from its file', async () => {
  const original = noQuery();
  const index = await indexWorkbook(original, { id: 'f0001', name: 'x.xlsm', relPath: 'x.xlsm', size: original.length });
  const { resolvePlan } = await import('../../src/batch/resolve/resolve.js');
  const plan = resolvePlan(moduleReplace(), [index], { now: NOW }).files[0];
  const edited = (await runFilePlan(original, { id: 'f0001', name: 'x.xlsm', relPath: 'x.xlsm', size: original.length }, plan, { now: NOW, dryRun: false, limits: { timeoutMs: 30000, maxRows: 1000000 }, culture: 'en-US', runId: 'seed', recipe: moduleReplace(), acknowledgeSignature: true })).bytes;
  const session = await settledSet([[original, 'a/original.xlsm'], [edited, 'b/edited.xlsm']]);
  const source = session.index('f0001').modules.find((m) => m.name === 'Module1');
  const recipe = recipeOf({ recipe: 'align', v: 1, align: { target: 'module', name: 'Module1', hash: source.hash } });
  const pool = inProcessPool();
  const loadAlignText = createVariantTextLoader({ pool, session, now: NOW, runId: 'r1' });
  const out = await preview({ session, pool, recipe, loadAlignText }).promise;
  assert.equal(out.ok, true);
  assert.deepEqual(out.rows.map((r) => [r.file, r.verdict, r.reason_code]), [['original.xlsm', 'unchanged', ''], ['edited.xlsm', 'changed', '']]);
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

test('cancelling while the outputs are being built stops quietly: cancelled result, session ready, no error', async () => {
  const session = await settledSet([[pq(), 'a/one.xlsx']]);
  const pool = inProcessPool();
  const recipe = injectReplace();
  const previewed = await preview({ session, pool, recipe }).promise;
  let handle = null;
  let sawStop = null;
  const build = async (result, { shouldStop }) => {
    handle.cancel();
    sawStop = shouldStop();
    return { ok: true, bytes: new Uint8Array(1), name: 'x.zip', rows: result.rows };
  };
  handle = startPlanRun({ mode: 'run', session, pool, recipe, now: NOW, runId: 'r1', preview: previewed, build });
  const out = await handle.promise;
  assert.deepEqual(out, { cancelled: true });
  assert.equal(sawStop, true);
  assert.equal(session.state, 'ready');
  assert.equal(session.move, null);
});

test('a run stopped after some files were written says how many and where, and a stop with nothing written says nothing more', async () => {
  const session = await settledSet([[pq(), 'a/one.xlsx'], [pq(), 'b/two.xlsx']]);
  const pool = inProcessPool();
  const recipe = injectReplace();
  const previewed = await preview({ session, pool, recipe }).promise;
  let handle = null;
  const stopped = async (result) => {
    handle.cancel();
    return { ok: true, stopped: true, name: 'out', files: ['a/one.xlsx'], rows: result.rows };
  };
  handle = startPlanRun({ mode: 'run', session, pool, recipe, now: NOW, runId: 'r1', preview: previewed, build: stopped });
  assert.deepEqual(await handle.promise, { cancelled: true, written: 1, into: 'out' });
  const none = async (result) => {
    handle.cancel();
    return { ok: true, stopped: true, name: 'out', files: [], rows: result.rows };
  };
  handle = startPlanRun({ mode: 'run', session, pool, recipe, now: NOW, runId: 'r2', preview: previewed, build: none });
  assert.deepEqual(await handle.promise, { cancelled: true });
});

test('a preview keeps the text before and after each change for the diff and a run does not carry any', async () => {
  const session = await settledSet([[pq(), 'a/one.xlsx']]);
  const pool = inProcessPool();
  const recipe = injectReplace();
  const previewed = await preview({ session, pool, recipe }).promise;
  const [change] = previewed.perFile.get('f0001').changes;
  assert.equal(typeof change.texts.before, 'string');
  assert.equal(typeof change.texts.after, 'string');
  assert.notEqual(change.texts.before, change.texts.after);
  assert.deepEqual(pool.submitted.map((s) => s.type), ['apply']);
  const ran = await startPlanRun({ mode: 'run', session, pool, recipe, now: NOW, runId: 'r2', preview: previewed }).promise;
  assert.equal('texts' in ran.perFile.get('f0001').changes[0], false);
});

test('a pattern that matches nothing in a file is a skipped row', async () => {
  const session = await settledSet([[pq(), 'a/one.xlsx'], [noQuery(), 'b/none.xlsm']]);
  const recipe = recipeOf({ recipe: 'inject', v: 1, inject: { target: 'query', op: 'replace', match: 'pattern', name: 'Student*', source: 'inline', text: NEW_M, refreshOnLoad: false } });
  const out = await preview({ session, pool: inProcessPool(), recipe }).promise;
  assert.deepEqual(out.rows.map((r) => [r.file, r.verdict, r.reason_code]), [['one.xlsx', 'changed', ''], ['none.xlsm', 'skipped', 'skip.notApplicable']]);
  assert.deepEqual(out.counts, { changed: 1, unchanged: 0, skipped: 1, refused: 0, failed: 0, cancelled: 0, 'not-released': 0 });
});

async function sheetPair(mutate = null) {
  const session = await settledSet([[pq(), 'a/one.xlsx'], [generated('signed.xlsm'), 'b/two.xlsm']]);
  const recipe = transformOf({ mode: 'newSheet' });
  const previewed = await preview({ session, pool: inProcessPool(), recipe }).promise;
  const run = await startPlanRun({ mode: 'run', session, pool: inProcessPool({ mutate }), recipe, now: NOW, runId: 'r2', preview: previewed, confirmSignatures: true, build: (result) => buildPlanOutput(result) }).promise;
  return { previewed, run };
}

test('a new-sheet preview has a row per unit naming the sheet and the copy, and one output hash per file with no bytes', async () => {
  const { previewed } = await sheetPair();
  assert.equal(previewed.ok, true);
  assert.deepEqual(previewed.rows.map((r) => [r.file, r.unit, r.verdict, r.output]), [
    ['one.xlsx', 'StudentNames', 'changed', 'one (edited).xlsx [Result]'],
    ['one.xlsx', 'StudentResults', 'changed', 'one (edited).xlsx [Result-2]'],
    ['two.xlsm', 'FinalTable', 'changed', 'two (edited).xlsm [Result]'],
    ['two.xlsm', 'RawInput', 'changed', 'two (edited).xlsm [Result-2]']
  ]);
  for (const held of previewed.perFile.values()) {
    assert.equal(held.bytes, null);
    assert.equal(held.outputs.length, 1);
    assert.deepEqual([held.outputs[0].bytes === undefined, /^[0-9a-f]{64}$/.test(held.outputs[0].sha256)], [true, true]);
  }
});

test('a new-sheet run releases one copy per file, equal to its preview, with every original sheet kept and the new ones added', async () => {
  const { previewed, run } = await sheetPair();
  assert.equal(run.ok, true);
  assert.equal(run.defect, false);
  assert.deepEqual(run.output.files, ['a/one (edited).xlsx', 'b/two (edited).xlsm']);
  for (const [id, held] of run.perFile) assert.equal(run.hashes.get(id), previewed.hashes.get(id));
  const [one, two] = [...run.perFile.values()];
  const source = await openWorkbook(pq(), 'one.xlsx');
  const copy = await openWorkbook(one.outputs[0].bytes, 'copy.xlsx');
  assert.deepEqual(copy.sheets.map((x) => x.name), [...source.sheets.map((x) => x.name), 'Result', 'Result-2']);
  const macro = await openWorkbook(two.outputs[0].bytes, 'copy.xlsm');
  assert.deepEqual(macro.sheets.map((x) => x.name).slice(-2), ['Result', 'Result-2']);
  assert.deepEqual(run.output.rows.map((r) => r.output), ['a/one (edited).xlsx [Result]', 'a/one (edited).xlsx [Result-2]', 'b/two (edited).xlsm [Result]', 'b/two (edited).xlsm [Result-2]']);
});

test('a new-sheet copy that differs from its preview is not released and its rows name no output', async () => {
  const flip = (result) => (result.fileId === 'f0002' ? { ...result, outputs: result.outputs.map((o) => ({ ...o, sha256: 'f'.repeat(64) })) } : result);
  const { run } = await sheetPair(flip);
  assert.equal(run.defect, true);
  assert.deepEqual(run.diverged, ['f0002']);
  assert.deepEqual(run.output.files, ['a/one (edited).xlsx']);
  assert.deepEqual(run.output.rows.map((r) => [r.verdict, r.output]), [['changed', 'a/one (edited).xlsx [Result]'], ['changed', 'a/one (edited).xlsx [Result-2]'], ['not-released', ''], ['not-released', '']]);
});

async function combinedPair(mutate = null) {
  const session = await settledSet([[pq(), 'a/one.xlsx'], [noQuery(), 'c/none.xlsm']]);
  const recipe = transformOf({ mode: 'combined' });
  const previewed = await preview({ session, pool: inProcessPool(), recipe }).promise;
  const run = await startPlanRun({ mode: 'run', session, pool: inProcessPool({ mutate }), recipe, now: NOW, runId: 'r2', preview: previewed, build: (result) => buildPlanOutput(result) }).promise;
  return { session, recipe, previewed, run };
}

test('a combined preview names the shared workbook and the sheet of every unit, keeps a hash per file, and holds no sheet xml', async () => {
  const { previewed } = await combinedPair();
  assert.equal(previewed.ok, true);
  assert.deepEqual(previewed.rows.map((r) => [r.file, r.unit, r.verdict, r.output, r.new_hash]), [
    ['one.xlsx', 'StudentNames', 'changed', 'Combined.xlsx [one__StudentNames]', ''],
    ['one.xlsx', 'StudentResults', 'changed', 'Combined.xlsx [one__StudentResults]', ''],
    ['none.xlsm', 'FinalTable', 'changed', 'Combined.xlsx [none__FinalTable]', ''],
    ['none.xlsm', 'RawInput', 'changed', 'Combined.xlsx [none__RawInput]', '']
  ]);
  assert.equal(previewed.combined, null);
  for (const [id, held] of previewed.perFile) {
    assert.match(previewed.hashes.get(id), /^[0-9a-f]{64}$/);
    assert.deepEqual([held.bytes, held.outputs, held.sheetParts], [null, [], []]);
  }
});

test('a combined run releases one workbook with a sheet per unit in plan order, and each row names it, its sheet and its hash', async () => {
  const { previewed, run } = await combinedPair();
  assert.equal(run.ok, true);
  assert.equal(run.defect, false);
  for (const [id] of run.perFile) assert.equal(run.hashes.get(id), previewed.hashes.get(id));
  assert.deepEqual(run.output.files, ['Combined.xlsx']);
  assert.deepEqual(run.combined.sheetNames, ['one__StudentNames', 'one__StudentResults', 'none__FinalTable', 'none__RawInput']);
  const wb = await openWorkbook(run.combined.bytes, 'Combined.xlsx');
  assert.deepEqual(wb.sheets.map((x) => x.name), run.combined.sheetNames);
  assert.deepEqual((await readUsedGrid(wb, 'one__StudentNames')).map((row) => row.map((c) => c.v)), [['Name', 'Age'], ['Alice', 30], ['Bob', 25], ['Charlie', 35]]);
  assert.deepEqual(run.output.rows.map((r) => [r.verdict, r.output, r.verified, r.new_hash === run.combined.sha256]), run.combined.sheetNames.map((n) => ['changed', `Combined.xlsx [${n}]`, true, true]));
  for (const held of run.perFile.values()) assert.deepEqual(held.sheetParts, []);
});

test('a combined run is byte for byte what combineOutputs makes from the same files in plan order', async () => {
  const { session, recipe, run } = await combinedPair();
  const plan = resolvePlan(recipe, [...session.list()].map((f) => session.file(f.id).index), { now: NOW });
  const results = [];
  for (const [bytes, name] of [[pq(), 'one.xlsx'], [noQuery(), 'none.xlsm']]) {
    const f = session.list().find((x) => x.name === name);
    const filePlan = plan.files.find((p) => p.fileId === f.id);
    results.push(await executeFile(await openWorkbook(bytes, name), filePlan, { now: NOW, recipe, meta: { id: f.id, name: f.name, relPath: f.relPath, size: f.size }, runId: 'r2' }));
  }
  const expected = await combineOutputs(results, { now: new Date(2026, 10, 14, 10, 0, 0) });
  assert.deepEqual(Array.from(run.combined.bytes), Array.from(expected.bytes));
});

test('a file whose sheets differ from its preview is left out of the combined workbook and its rows are not released', async () => {
  const flip = (result) => (result.fileId === 'f0002' ? { ...result, sheetParts: result.sheetParts.map((p) => ({ ...p, digest: 'f'.repeat(64) })) } : result);
  const { run } = await combinedPair(flip);
  assert.equal(run.defect, true);
  assert.deepEqual(run.diverged, ['f0002']);
  assert.deepEqual(run.combined.sheetNames, ['one__StudentNames', 'one__StudentResults']);
  assert.deepEqual(run.output.rows.map((r) => [r.verdict, r.output]), [['changed', 'Combined.xlsx [one__StudentNames]'], ['changed', 'Combined.xlsx [one__StudentResults]'], ['not-released', ''], ['not-released', '']]);
});

test('when no unit gives a table there is no combined workbook', async () => {
  const session = await settledSet([[pq(), 'a/one.xlsx']]);
  const recipe = transformOf({ mode: 'combined' }, { query: { source: 'inline', m: 'error "boom"' } });
  const previewed = await preview({ session, pool: inProcessPool(), recipe }).promise;
  const run = await startPlanRun({ mode: 'run', session, pool: inProcessPool(), recipe, now: NOW, runId: 'r2', preview: previewed, build: (result) => buildPlanOutput(result) }).promise;
  assert.equal(run.combined, null);
  assert.deepEqual(run.output.files, []);
  assert.ok(run.output.rows.every((r) => r.verdict === 'failed' && r.output === ''));
});

test('the plan summary reads as section 9 words it and keeps singular and plural right', () => {
  assert.equal(S.planSummary({ files: 10, units: 13, groups: [{ unitsPerFile: 1, files: 7 }, { unitsPerFile: 2, files: 3 }] }), '7 files → 1 unit each, 3 files → 2 units each — 13 units across 10 files');
  assert.equal(S.planSummary({ files: 1, units: 1, groups: [{ unitsPerFile: 1, files: 1 }] }), '1 file → 1 unit each — 1 unit across 1 file');
});


test('each job is charged to the pool at the inflated size its index declares, never less than the file on disk', async () => {
  const session = await settledSet([[pq(), 'a/one.xlsx'], [noQuery(), 'c/none.xlsm']]);
  const pool = inProcessPool();
  await preview({ session, pool, recipe: injectReplace() }).promise;
  const charged = new Map(pool.submitted.map((s) => [s.id, s.estimate]));
  const files = session.list();
  for (const f of files) assert.equal(charged.get(f.id), Math.max(f.size, f.index.inflated));
  assert.ok(files.some((f) => charged.get(f.id) > f.size));
});
