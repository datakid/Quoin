import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { indexWorkbook } from '../../src/batch/index/file-index.js';
import { resolvePlan } from '../../src/batch/resolve/resolve.js';
import { parseRecipe } from '../../src/batch/recipe/recipe.js';
import { executeFilePlan } from '../../src/batch/execute/collect.js';
import { openApp, fx, expectSameOutput } from './helpers.js';

const NOW = '2026-11-14T10:00:00.000Z';
const recipe = parseRecipe(JSON.stringify({ recipe: 'collect', v: 1 })).recipe;

async function planFor(bytes, name) {
  const meta = { id: 'f0001', name, relPath: name, size: bytes.length };
  const index = await indexWorkbook(bytes, meta);
  return { meta, filePlan: resolvePlan(recipe, [index], { now: NOW }).files[0] };
}

const applyInPage = (page, { url, name, filePlan, extraBytes }) =>
  page.evaluate(
    async ({ url, name, filePlan, extraBytes }) => {
      const bytes = extraBytes ? Uint8Array.from(extraBytes) : new Uint8Array(await (await fetch(url)).arrayBuffer());
      const worker = new Worker('/src/workers/m-worker.js', { type: 'module' });
      const out = [];
      worker.onmessage = (ev) => out.push(ev.data);
      const fileRef = { id: 'f0001', name, relPath: name, size: bytes.length, lastModified: 1, file: new File([bytes], name) };
      const send = async (n) => {
        const before = out.length;
        worker.postMessage({ type: 'apply', fileRef, filePlan, options: { now: '2026-11-14T10:00:00.000Z', dryRun: false, limits: { timeoutMs: 30000, maxRows: 1000000 }, culture: 'en-US', runId: 'r1' } });
        const start = performance.now();
        while (out.length === before && performance.now() - start < 20000) await new Promise((r) => setTimeout(r, 20));
        return out[out.length - 1];
      };
      const hex = async (u8) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', u8)), (b) => b.toString(16).padStart(2, '0')).join('');
      const first = await send(1);
      const second = await send(2);
      worker.terminate();
      const view = async (m) => ({ type: m.type, fileId: m.fileId, bytes: m.result.bytes ? Array.from(m.result.bytes) : null, bytesLength: m.result.bytes ? m.result.bytes.length : null, bytesHash: m.result.bytes ? await hex(m.result.bytes) : null, sha256: m.result.sha256, rows: m.result.rows.map((r) => ({ ...r, duration_ms: 0 })) });
      return { first: await view(first), second: await view(second) };
    },
    { url, name, filePlan, extraBytes }
  );

test('fable collect worker: apply returns the same zip content, hash and rows as Node, twice in a row on one worker', async ({ page, browserName }) => {
  await openApp(page);
  const bytes = new Uint8Array(readFileSync(fx('mixed.xlsm')));
  const { meta, filePlan } = await planFor(bytes, 'mixed.xlsm');
  const expected = await executeFilePlan(bytes, meta, filePlan, { now: NOW, runId: 'r1' });
  const { first, second } = await applyInPage(page, { url: '/tests/fixtures/workbooks/mixed.xlsm', name: 'mixed.xlsm', filePlan });
  for (const got of [first, second]) {
    expect(got.type).toBe('applied');
    expect(got.fileId).toBe('f0001');
    await expectSameOutput(got, { bytes: expected.bytes, bytesLength: expected.bytes.length, sha256: expected.sha256 }, browserName);
    expect(got.rows).toEqual(expected.rows.map((r) => ({ ...r, duration_ms: 0 })));
  }
});

test('fable collect worker: a file that cannot be opened comes back as one failed row and the worker keeps working', async ({ page }) => {
  await openApp(page);
  const junk = Array.from(new TextEncoder().encode('not a workbook at all'));
  const filePlan = { fileId: 'f0001', source: 'rule', units: [{ fileId: 'f0001', kind: 'workbook', name: 'junk', index: 1 }], actions: [], skipped: null };
  const { first, second } = await applyInPage(page, { url: '', name: 'junk.xlsx', filePlan, extraBytes: junk });
  for (const got of [first, second]) {
    expect(got.type).toBe('applied');
    expect([got.bytesLength, got.sha256]).toEqual([null, null]);
    expect(got.rows).toHaveLength(1);
    expect([got.rows[0].verdict, got.rows[0].file, got.rows[0].unit]).toEqual(['failed', 'junk.xlsx', 'junk']);
    expect(got.rows[0].reason_code).toMatch(/^[a-z]+\.[A-Za-z]+$/);
  }
});
