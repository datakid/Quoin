import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { indexWorkbook } from '../../src/batch/index/file-index.js';
import { resolvePlan } from '../../src/batch/resolve/resolve.js';
import { parseRecipe } from '../../src/batch/recipe/recipe.js';
import { runFilePlan } from '../../src/batch/execute/run-file.js';
import { openApp, fx, ext, expectSameOutput } from './helpers.js';

const NOW = '2026-11-14T10:00:00.000Z';
const LIMITS = { timeoutMs: 30000, maxRows: 1000000 };
const NEW_M = 'let\n    Source = 2\nin\n    Source';

const injectReplace = { recipe: 'inject', v: 1, inject: { target: 'query', op: 'replace', match: 'name', name: 'StudentResults', source: 'inline', text: NEW_M, refreshOnLoad: false } };
const replaceCode = { recipe: 'replace', v: 1, replace: { in: ['m', 'vba'], find: 'DateTime', with: 'MyDateTime', kind: 'text', matchCase: true } };
const moduleReplace = { recipe: 'inject', v: 1, inject: { target: 'module', op: 'replace', match: 'name', name: 'Module1', source: 'inline', text: 'Sub A()\r\nEnd Sub\r\n', refreshOnLoad: false } };

async function planFor(path, name, json) {
  const bytes = new Uint8Array(readFileSync(path));
  const recipe = parseRecipe(JSON.stringify(json)).recipe;
  const meta = { id: 'f0001', name, relPath: name, size: bytes.length };
  const index = await indexWorkbook(bytes, meta);
  return { bytes, recipe, meta, filePlan: resolvePlan(recipe, [index], { now: NOW }).files[0] };
}

const expectedOf = async ({ bytes, recipe, meta, filePlan }, extra = {}) => {
  const res = await runFilePlan(bytes, meta, filePlan, { now: NOW, dryRun: false, limits: LIMITS, culture: 'en-US', runId: 'r1', recipe, ...extra });
  return { bytes: res.bytes, bytesLength: res.bytes ? res.bytes.length : null, sha256: res.sha256, rows: res.rows.map((r) => ({ ...r, duration_ms: 0 })) };
};

const talk = (page, { name, bytes, filePlan, optionsList }) =>
  page.evaluate(
    async ({ name, bytes, filePlan, optionsList }) => {
      const data = Uint8Array.from(bytes);
      const worker = new Worker('/src/workers/m-worker.js', { type: 'module' });
      const out = [];
      worker.onmessage = (ev) => out.push(ev.data);
      const fileRef = { id: 'f0001', name, relPath: name, size: data.length, lastModified: 1, file: new File([data], name) };
      const hex = async (u8) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', u8)), (b) => b.toString(16).padStart(2, '0')).join('');
      const replies = [];
      for (const extra of optionsList) {
        const before = out.length;
        worker.postMessage({ type: 'apply', fileRef, filePlan, options: { now: '2026-11-14T10:00:00.000Z', dryRun: false, limits: { timeoutMs: 30000, maxRows: 1000000 }, culture: 'en-US', runId: 'r1', ...extra } });
        const start = performance.now();
        while (out.length === before && performance.now() - start < 20000) await new Promise((r) => setTimeout(r, 20));
        const m = out[out.length - 1];
        if (m.type !== 'applied') {
          replies.push({ type: m.type, code: m.code || null });
          continue;
        }
        replies.push({ type: m.type, bytes: m.result.bytes ? Array.from(m.result.bytes) : null, bytesLength: m.result.bytes ? m.result.bytes.length : null, bytesHash: m.result.bytes ? await hex(m.result.bytes) : null, sha256: m.result.sha256, rows: m.result.rows.map((r) => ({ ...r, duration_ms: 0 })) });
      }
      worker.terminate();
      return replies;
    },
    { name, bytes: Array.from(bytes), filePlan, optionsList }
  );

test('fable apply worker: an inject replace gives the same content, hash and rows as Node, twice in a row', async ({ page, browserName }) => {
  await openApp(page);
  const planned = await planFor(ext('pq_simple.xlsx'), 'pq_simple.xlsx', injectReplace);
  const expected = await expectedOf(planned);
  const [first, second] = await talk(page, { name: 'pq_simple.xlsx', bytes: planned.bytes, filePlan: planned.filePlan, optionsList: [{ recipe: planned.recipe }, { recipe: planned.recipe }] });
  expect(expected.rows.map((r) => [r.recipe, r.action, r.verdict, r.verified])).toEqual([['inject', 'replace', 'changed', true]]);
  for (const got of [first, second]) {
    expect(got.type).toBe('applied');
    await expectSameOutput(got, expected, browserName);
    expect(got.rows).toEqual(expected.rows);
  }
});

test('fable apply worker: a replace in code recipe matches Node', async ({ page, browserName }) => {
  await openApp(page);
  const planned = await planFor(fx('mixed.xlsm'), 'mixed.xlsm', replaceCode);
  const expected = await expectedOf(planned);
  const [got] = await talk(page, { name: 'mixed.xlsm', bytes: planned.bytes, filePlan: planned.filePlan, optionsList: [{ recipe: planned.recipe }] });
  expect(expected.rows.length).toBeGreaterThan(0);
  await expectSameOutput(got, expected, browserName);
  expect(got.rows).toEqual(expected.rows);
  expect(got.rows.some((r) => r.verdict === 'changed')).toBe(true);
});

test('fable apply worker: the signature confirmation travels in the options and changes the verdict', async ({ page, browserName }) => {
  await openApp(page);
  const planned = await planFor(fx('signed.xlsm'), 'signed.xlsm', moduleReplace);
  const [refused, confirmed] = await talk(page, { name: 'signed.xlsm', bytes: planned.bytes, filePlan: planned.filePlan, optionsList: [{ recipe: planned.recipe }, { recipe: planned.recipe, acknowledgeSignature: true }] });
  expect([refused.bytesLength, refused.rows.map((r) => [r.verdict, r.reason_code])]).toEqual([null, [['refused', 'vba.signature']]]);
  const expected = await expectedOf(planned, { acknowledgeSignature: true });
  await expectSameOutput(confirmed, expected, browserName);
  expect(confirmed.rows.map((r) => [r.verdict, r.signature_removed, r.verified])).toEqual([['changed', true, true]]);
});

test('fable apply worker: a message with a bad recipe is refused and the worker keeps working', async ({ page, browserName }) => {
  await openApp(page);
  const planned = await planFor(ext('pq_simple.xlsx'), 'pq_simple.xlsx', injectReplace);
  const expected = await expectedOf(planned);
  const [bad, good] = await talk(page, { name: 'pq_simple.xlsx', bytes: planned.bytes, filePlan: planned.filePlan, optionsList: [{ recipe: 'inject' }, { recipe: planned.recipe }] });
  expect(bad.type).toBe('refused');
  expect(good.type).toBe('applied');
  await expectSameOutput(good, expected, browserName);
});

test('fable apply worker: a file that cannot be opened is one failed row for the recipe and the worker keeps working', async ({ page }) => {
  await openApp(page);
  const planned = await planFor(ext('pq_simple.xlsx'), 'pq_simple.xlsx', injectReplace);
  const junk = new TextEncoder().encode('not a workbook at all');
  const [first, second] = await talk(page, { name: 'junk.xlsx', bytes: junk, filePlan: planned.filePlan, optionsList: [{ recipe: planned.recipe }, { recipe: planned.recipe }] });
  for (const got of [first, second]) {
    expect(got.type).toBe('applied');
    expect([got.bytesLength, got.sha256]).toEqual([null, null]);
    expect(got.rows.length).toBeGreaterThan(0);
    expect(got.rows.every((r) => r.verdict === 'failed' && r.recipe === 'inject' && /^[a-z]+\.[A-Za-z]+$/.test(r.reason_code))).toBe(true);
  }
});
