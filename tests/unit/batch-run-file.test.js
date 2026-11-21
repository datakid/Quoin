import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runFilePlan } from '../../src/batch/execute/run-file.js';
import { executeFile } from '../../src/batch/execute/index.js';
import { executeFilePlan } from '../../src/batch/execute/collect.js';
import { indexWorkbook } from '../../src/batch/index/file-index.js';
import { resolvePlan } from '../../src/batch/resolve/resolve.js';
import { parseRecipe } from '../../src/batch/recipe/recipe.js';
import { openWorkbook } from '../../src/core/workbook.js';
import { fixture, generated } from './helpers.js';

const NOW = '2026-11-14T10:00:00.000Z';
const NEW_M = 'let\n    Source = 2\nin\n    Source';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const LIMITS = { timeoutMs: 30000, maxRows: 1000000 };
const options = (recipe, over = {}) => ({ now: NOW, dryRun: false, limits: LIMITS, culture: 'en-US', runId: 'r1', recipe, ...over });

async function planFor(bytes, name, recipeJson) {
  const recipe = parseRecipe(JSON.stringify(recipeJson)).recipe;
  const meta = { id: 'f0001', name, relPath: name, size: bytes.length };
  const index = await indexWorkbook(bytes, meta);
  const plan = resolvePlan(recipe, [index], { now: NOW });
  return { recipe, meta, filePlan: plan.files[0] };
}

const injectReplace = { recipe: 'inject', v: 1, inject: { target: 'query', op: 'replace', match: 'name', name: 'StudentResults', source: 'inline', text: NEW_M, refreshOnLoad: false } };
const replaceCode = { recipe: 'replace', v: 1, replace: { in: ['m', 'vba'], find: 'DateTime', with: 'MyDateTime', kind: 'text', matchCase: true } };

test('an inject recipe gives the same bytes as executeFile on the opened workbook', async () => {
  const bytes = fixture('pq_simple.xlsx');
  const { recipe, meta, filePlan } = await planFor(bytes, 'pq_simple.xlsx', injectReplace);
  const viaRun = await runFilePlan(bytes, meta, filePlan, options(recipe));
  const wb = await openWorkbook(bytes, 'pq_simple.xlsx');
  const direct = await executeFile(wb, filePlan, { now: NOW, recipe, meta, runId: 'r1' });
  assert.ok(viaRun.bytes instanceof Uint8Array);
  assert.equal(viaRun.sha256, sha(viaRun.bytes));
  assert.equal(viaRun.sha256, direct.sha256);
  assert.deepEqual(viaRun.rows.map((r) => [r.recipe, r.action, r.verdict, r.verified]), [['inject', 'replace', 'changed', true]]);
});

test('the same inputs and the same time give the same bytes twice', async () => {
  const bytes = fixture('pq_simple.xlsx');
  const { recipe, meta, filePlan } = await planFor(bytes, 'pq_simple.xlsx', injectReplace);
  const a = await runFilePlan(bytes, meta, filePlan, options(recipe));
  const b = await runFilePlan(bytes, meta, filePlan, options(recipe));
  assert.equal(a.sha256, b.sha256);
  assert.deepEqual(a.rows.map((r) => ({ ...r, duration_ms: 0 })), b.rows.map((r) => ({ ...r, duration_ms: 0 })));
});

test('a replace in code recipe changes the text in the file', async () => {
  const bytes = generated('mixed.xlsm');
  const { recipe, meta, filePlan } = await planFor(bytes, 'mixed.xlsm', replaceCode);
  const res = await runFilePlan(bytes, meta, filePlan, options(recipe));
  assert.ok(res.rows.length > 0);
  assert.ok(res.rows.every((r) => r.recipe === 'replace'));
  assert.ok(res.rows.some((r) => r.verdict === 'changed'));
  assert.ok(res.changes.every((c) => c.op === 'replaceText'));
});

test('the input bytes are never changed', async () => {
  const bytes = fixture('pq_simple.xlsx');
  const before = sha(bytes);
  const { recipe, meta, filePlan } = await planFor(bytes, 'pq_simple.xlsx', injectReplace);
  await runFilePlan(bytes, meta, filePlan, options(recipe));
  assert.equal(sha(bytes), before);
});

test('a collect recipe is handled exactly as before', async () => {
  const bytes = generated('mixed.xlsm');
  const { recipe, meta, filePlan } = await planFor(bytes, 'mixed.xlsm', { recipe: 'collect', v: 1 });
  const viaRun = await runFilePlan(bytes, meta, filePlan, options(recipe));
  const old = await executeFilePlan(bytes, meta, filePlan, { now: NOW, runId: 'r1' });
  assert.equal(viaRun.sha256, old.sha256);
  assert.deepEqual(viaRun.rows.map((r) => ({ ...r, duration_ms: 0 })), old.rows.map((r) => ({ ...r, duration_ms: 0 })));
});

test('options with no recipe still run as a collect', async () => {
  const bytes = generated('mixed.xlsm');
  const { meta, filePlan } = await planFor(bytes, 'mixed.xlsm', { recipe: 'collect', v: 1 });
  const res = await runFilePlan(bytes, meta, filePlan, { now: NOW, dryRun: false, limits: LIMITS, culture: 'en-US', runId: 'r1' });
  assert.ok(res.bytes instanceof Uint8Array);
  assert.ok(res.rows.every((r) => r.recipe === 'collect'));
});

test('bytes that are not a workbook give failed rows for the recipe, not a throw', async () => {
  const bytes = fixture('pq_simple.xlsx');
  const { recipe, meta, filePlan } = await planFor(bytes, 'pq_simple.xlsx', injectReplace);
  const res = await runFilePlan(new Uint8Array([1, 2, 3, 4]), meta, filePlan, options(recipe));
  assert.equal(res.bytes, null);
  assert.equal(res.sha256, null);
  assert.ok(res.rows.length > 0);
  assert.ok(res.rows.every((r) => r.verdict === 'failed' && r.recipe === 'inject' && typeof r.reason_code === 'string' && r.reason_code.length > 0));
});

test('a deadline that has passed fails every row with m.timeout and writes nothing', async () => {
  const bytes = generated('mixed.xlsm');
  const { recipe, meta, filePlan } = await planFor(bytes, 'mixed.xlsm', replaceCode);
  const res = await runFilePlan(bytes, meta, filePlan, options(recipe, { shouldStop: () => true }));
  assert.equal(res.bytes, null);
  assert.ok(res.rows.every((r) => r.verdict === 'failed' && r.reason_code === 'm.timeout'));
});

test('a recipe kind that is not wired yet is refused loudly', async () => {
  const bytes = fixture('pq_simple.xlsx');
  const { meta, filePlan } = await planFor(bytes, 'pq_simple.xlsx', { recipe: 'collect', v: 1 });
  const transform = parseRecipe(JSON.stringify({ recipe: 'transform', v: 1, query: { source: 'inline', m: 'let x = 1 in x' }, output: { mode: 'newFile' } })).recipe;
  await assert.rejects(() => runFilePlan(bytes, meta, filePlan, options(transform)), /not (wired|supported)/);
});

test('a module replace in a signed project is refused until the set has confirmed, then marks the signature as removed', async () => {
  const bytes = generated('signed.xlsm');
  const moduleReplace = { recipe: 'inject', v: 1, inject: { target: 'module', op: 'replace', match: 'name', name: 'Module1', source: 'inline', text: 'Sub A()\r\nEnd Sub\r\n', refreshOnLoad: false } };
  const { recipe, meta, filePlan } = await planFor(bytes, 'signed.xlsm', moduleReplace);
  const refused = await runFilePlan(bytes, meta, filePlan, options(recipe));
  assert.equal(refused.bytes, null);
  assert.deepEqual(refused.rows.map((r) => [r.verdict, r.reason_code, r.signature_removed]), [['refused', 'vba.signature', false]]);
  const confirmed = await runFilePlan(bytes, meta, filePlan, options(recipe, { acknowledgeSignature: true }));
  assert.ok(confirmed.bytes instanceof Uint8Array);
  assert.deepEqual(confirmed.rows.map((r) => [r.verdict, r.signature_removed, r.verified]), [['changed', true, true]]);
});

test('the result survives structured clone', async () => {
  const bytes = fixture('pq_simple.xlsx');
  const { recipe, meta, filePlan } = await planFor(bytes, 'pq_simple.xlsx', injectReplace);
  const res = await runFilePlan(bytes, meta, filePlan, options(recipe));
  assert.deepEqual(structuredClone(res).rows, res.rows);
});
