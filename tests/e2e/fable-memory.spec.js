import { test, expect } from '@playwright/test';
import { ext, fx, openApp, dropTree, waitForSet } from './helpers.js';
import { give, previewButton, getButton, matrix, b64 } from './fable-batch.js';

const replaceCode = { recipe: 'replace', v: 1, replace: { in: ['m', 'vba'], find: 'DateTime', with: 'MyDateTime', kind: 'text', matchCase: true } };
const sources = { pq: ext('pq_simple.xlsx'), vba: fx('mixed.xlsm') };
const folders = ['east', 'west', 'north', 'south', 'centre'];
const files = Array.from({ length: 50 }, (_, i) => {
  const kind = i % 2 === 0 ? 'pq' : 'vba';
  return { kind, folder: folders[i % folders.length], name: `${kind}${String(i).padStart(2, '0')}.${kind === 'pq' ? 'xlsx' : 'xlsm'}` };
});

const heapOf = async (cdp) => {
  for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage');
  const usage = await cdp.send('Runtime.getHeapUsage');
  return usage.usedSize + usage.backingStorageSize;
};

const poolStats = (page) => page.evaluate(async () => (await import('/src/app/pool.js')).sharedPool().stats());

async function dropFifty(page) {
  const byFolder = folders.map((name) => ({ name, children: files.filter((f) => f.folder === name).map((f) => ({ name: f.name, data: b64(sources[f.kind]) })) }));
  await dropTree(page, [{ name: 'books', children: byFolder }]);
  await waitForSet(page);
}

async function oneRun(page) {
  await give(page, replaceCode);
  await previewButton(page).click();
  await expect(matrix(page)).toBeVisible({ timeout: 120000 });
  const [download] = await Promise.all([page.waitForEvent('download'), getButton(page).click()]);
  await download.path();
  await expect(page.locator('.recipe-notes')).toContainText('Downloaded', { timeout: 120000 });
}

test('fable memory: after 50-file Previews and Gets the main-thread heap stays within 10% of its baseline and the pool holds nothing', async ({ page }) => {
  test.setTimeout(240000);
  await openApp(page);
  await dropFifty(page);
  const cdp = await page.context().newCDPSession(page);
  await oneRun(page);
  const baseline = await heapOf(cdp);
  const heaps = [];
  for (let round = 0; round < 4; round++) {
    await oneRun(page);
    heaps.push(await heapOf(cdp));
  }
  for (const heap of heaps) expect(heap).toBeLessThanOrEqual(baseline * 1.1);
  const stats = await poolStats(page);
  expect(stats.inFlightBytes).toBe(0);
  expect(stats.running).toBe(0);
  expect(stats.queued).toBe(0);
  expect(stats.idle).toBe(stats.workers);
  expect(stats.leased).toBe(0);
});

test('fable memory: a Preview alone, with no Get, keeps no workbook bytes on the main thread', async ({ page }) => {
  test.setTimeout(240000);
  await openApp(page);
  await dropFifty(page);
  const cdp = await page.context().newCDPSession(page);
  await give(page, replaceCode);
  await previewButton(page).click();
  await expect(matrix(page)).toBeVisible({ timeout: 120000 });
  const held = await page.evaluate(() => {
    const p = window.__quoin.preview;
    return [...p.perFile.values()].reduce((n, f) => n + (f.bytes ? 1 : 0) + f.outputs.filter((o) => o.bytes).length, 0);
  });
  expect(held).toBe(0);
  const heap = await heapOf(cdp);
  expect(heap).toBeLessThan(40 * 1024 * 1024);
});
