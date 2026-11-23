import { test, expect } from '@playwright/test';
import { ext } from './helpers.js';
import { NEW_M, inject, give, openSet, previewButton, getButton, folderButton, matrix, panel, b64 } from './fable-batch.js';

const recipe = inject({ target: 'query', op: 'replace', name: 'StudentResults', text: NEW_M });
const many = (n) => Array.from({ length: n }, (_, i) => [`f${String(i).padStart(2, '0')}.xlsx`, null, b64(ext('pq_simple.xlsx'))]);

async function ready(page, n = 50) {
  await openSet(page, many(n));
  await give(page, recipe);
  await previewButton(page).click();
  await expect(matrix(page)).toBeVisible();
  await expect(getButton(page)).toBeVisible();
}

const installFolder = (page, { closeMs = 0 } = {}) => page.addInitScript((ms) => {
  const log = { opened: [], closed: [], aborted: [] };
  const files = {};
  const make = (path) => ({
    name: path.split('/').pop() || 'out',
    async getDirectoryHandle(name) {
      return make(`${path}/${name}`);
    },
    async getFileHandle(name, opts) {
      const full = `${path}/${name}`;
      if (!(full in files) && !opts) throw Object.assign(new Error('x'), { name: 'NotFoundError' });
      return {
        async createWritable() {
          log.opened.push(full);
          let staged = null;
          return {
            async write(d) { staged = new Uint8Array(d); },
            async close() {
              if (ms) await new Promise((r) => setTimeout(r, ms));
              files[full] = staged;
              log.closed.push(full);
            },
            async abort() { log.aborted.push(full); }
          };
        },
        async getFile() {
          const b = files[full];
          return { arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) };
        }
      };
    },
    async removeEntry(name) {
      delete files[`${path}/${name}`];
    }
  });
  window.__out = { log, files };
  window.showDirectoryPicker = async () => make('out');
}, closeMs);

const outState = (page) => page.evaluate(() => ({ opened: window.__out.log.opened.length, closed: window.__out.log.closed.length, aborted: window.__out.log.aborted.length, names: Object.keys(window.__out.files).sort(), sizes: Object.values(window.__out.files).map((b) => b.length) }));

test('fable cancel: stopping a zip run in the middle downloads nothing, and the preview and Get are still there afterwards', async ({ page }) => {
  let downloads = 0;
  page.on('download', () => downloads++);
  await ready(page);
  await page.evaluate(() => {
    window.__get = window.__quoin.getRecipe({ folder: false });
  });
  await page.waitForFunction(() => window.__quoin.set.state === 'running');
  const asked = Date.now();
  await page.evaluate(() => window.__quoin.cancelSetRun());
  await page.waitForFunction(() => window.__quoin.set.state === 'ready');
  expect(Date.now() - asked).toBeLessThan(1000);
  const settled = await page.evaluate(async () => (await window.__get).cancelled === true);
  expect(settled).toBe(true);
  expect(Date.now() - asked).toBeLessThan(1000);
  await page.waitForTimeout(1200);
  expect(downloads).toBe(0);
  await expect(getButton(page)).toBeVisible();
  await expect(matrix(page)).toBeVisible();
  await expect(panel(page).locator('.recipe-notes')).toHaveText('Stopped. Nothing was downloaded.');
  expect(await page.evaluate(() => window.__quoin.preview !== null)).toBe(true);
});

test('fable cancel: stopping a folder run between files leaves only complete files, opens nothing new afterwards, and no report', async ({ page }) => {
  await installFolder(page, { closeMs: 60 });
  await ready(page);
  await page.evaluate(() => {
    window.__get = window.__quoin.getRecipe({ folder: true });
  });
  await page.waitForFunction(() => window.__out.log.closed.length >= 4, null, { timeout: 30000 });
  await page.evaluate(() => window.__quoin.cancelSetRun());
  const result = await page.evaluate(async () => {
    const out = await window.__get;
    return { cancelled: out.cancelled, written: out.written, into: out.into };
  });
  const at = await outState(page);
  expect(result.cancelled).toBe(true);
  expect(result.into).toBe('out');
  expect(result.written).toBe(at.closed);
  await page.waitForTimeout(1000);
  const later = await outState(page);
  expect(later).toEqual(at);
  expect(later.opened).toBe(later.closed + later.aborted);
  expect(later.closed).toBeGreaterThanOrEqual(4);
  expect(later.closed).toBeLessThan(50);
  expect(later.names).not.toContain('out/report.csv');
  await expect(panel(page).locator('.recipe-notes')).toHaveText(`Stopped. ${later.closed} workbooks were written to out. The rest were not.`);
  await expect(matrix(page)).toBeVisible();
  expect(later.sizes.every((n) => n > 1000)).toBe(true);
  const hashes = await page.evaluate(() => [...window.__quoin.preview.hashes.values()]);
  expect(hashes.length).toBe(50);
  const sums = await page.evaluate(async () => {
    const out = [];
    for (const b of Object.values(window.__out.files)) out.push([...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join(''));
    return out;
  });
  for (const s of sums) expect(hashes).toContain(s);
  await expect(folderButton(page)).toBeVisible();
});

test('fable cancel: stopping while the workers are still running writes nothing at all', async ({ page }) => {
  await installFolder(page);
  await ready(page);
  await page.evaluate(() => {
    window.__get = window.__quoin.getRecipe({ folder: true });
  });
  await page.waitForFunction(() => window.__quoin.set.state === 'running');
  await page.evaluate(() => window.__quoin.cancelSetRun());
  await page.evaluate(async () => { await window.__get; });
  await page.waitForTimeout(800);
  const state = await outState(page);
  await expect(panel(page).locator('.recipe-notes')).toHaveText('Stopped. Nothing was written.');
  expect(state.opened).toBe(state.closed + state.aborted);
  expect(state.names).toEqual([]);
  expect(await page.evaluate(() => window.__quoin.set.state)).toBe('ready');
});

test('fable cancel: after a stopped run the same preview can be got again in full', async ({ page }) => {
  await installFolder(page, { closeMs: 20 });
  await ready(page, 12);
  await page.evaluate(() => {
    window.__get = window.__quoin.getRecipe({ folder: true });
  });
  await page.waitForFunction(() => window.__out.log.closed.length >= 2, null, { timeout: 30000 });
  await page.evaluate(() => window.__quoin.cancelSetRun());
  await page.evaluate(async () => { await window.__get; });
  await folderButton(page).click();
  await expect(panel(page).locator('.recipe-notes')).toContainText('12 workbooks and report.csv');
  expect(await page.evaluate(() => window.__quoin.set.state)).toBe('done');
});
