import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Package } from '../../src/core/opc.js';
import { readZip } from '../../src/core/zip-read.js';
import { ext, fx, openApp, dropTree, waitForSet } from './helpers.js';

const b64 = (path) => readFileSync(path).toString('base64');
const NEW_M = 'let\n    Source = 2\nin\n    Source';

const injectReplace = { recipe: 'inject', v: 1, inject: { target: 'query', op: 'replace', match: 'name', name: 'StudentResults', source: 'inline', text: NEW_M, refreshOnLoad: false } };
const moduleReplace = { recipe: 'inject', v: 1, inject: { target: 'module', op: 'replace', match: 'name', name: 'Module1', source: 'inline', text: 'Sub A()\r\nEnd Sub\r\n', refreshOnLoad: false } };

const recipeInput = (page) => page.locator('input[aria-label="Recipe file"]');
const matrix = (page) => page.getByRole('grid', { name: 'Run results' });
const previewButton = (page) => page.getByRole('button', { name: 'Preview', exact: true });
const getButton = (page) => page.getByRole('button', { name: 'Get', exact: true });
const folderButton = (page) => page.getByRole('button', { name: 'Get into a folder' });
const panel = (page) => page.locator('.recipe-panel');

const give = (page, json) => recipeInput(page).setInputFiles({ name: 'my.quoin-recipe.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) });

async function openSet(page, files) {
  const problems = await openApp(page);
  await dropTree(page, [{ name: 'books', children: files.map(([name, path]) => ({ name, data: b64(path) })) }]);
  await waitForSet(page);
  return problems;
}

async function previewed(page, files, recipe) {
  const problems = await openSet(page, files);
  await give(page, recipe);
  await previewButton(page).click();
  await expect(matrix(page)).toBeVisible();
  return problems;
}

async function zipOf(download) {
  const pkg = new Package(readZip(new Uint8Array(readFileSync(await download.path()))));
  const entries = new Map();
  for (const name of pkg.names()) entries.set(name, await pkg.bytes(name));
  return entries;
}

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const csvOf = (bytes) => new TextDecoder().decode(bytes.slice(3)).split('\r\n').filter(Boolean).map((l) => l.split(','));

const twoBooks = [['a.xlsx', ext('pq_simple.xlsx')], ['b.xlsx', ext('pq_simple.xlsx')], ['mixed.xlsm', fx('mixed.xlsm')]];

test('fable get: Get is offered only after a preview with something to change, and a zip of the changed workbooks and a report downloads', async ({ page }) => {
  const problems = await openSet(page, twoBooks);
  await give(page, injectReplace);
  await expect(getButton(page)).toBeHidden();
  await previewButton(page).click();
  await expect(matrix(page)).toBeVisible();
  await expect(getButton(page)).toBeVisible();
  const hashes = await page.evaluate(() => {
    const { hashes, indexes } = window.__quoin.preview;
    return [...hashes].map(([id, h]) => [indexes.find((i) => i.id === id).relPath, h]);
  });
  const [download] = await Promise.all([page.waitForEvent('download'), getButton(page).click()]);
  expect(download.suggestedFilename()).toMatch(/^Inject \d{4}-\d{2}-\d{2}\.zip$/);
  const entries = await zipOf(download);
  expect([...entries.keys()].sort()).toEqual(['books/a.xlsx', 'books/b.xlsx', 'report.csv']);
  expect(hashes.length).toBe(2);
  for (const [path, hash] of hashes) expect(sha(entries.get(path))).toBe(hash);
  const rows = csvOf(entries.get('report.csv'));
  const col = rows[0].indexOf('output');
  expect(rows.slice(1).filter((r) => r[col] !== '""').map((r) => r[col]).sort()).toEqual(['books/a.xlsx', 'books/b.xlsx']);
  await expect(panel(page).locator('.recipe-notes')).toContainText('2 changed');
  await expect(panel(page).locator('.recipe-notes')).toContainText(/Downloaded Inject \d{4}-\d{2}-\d{2}\.zip\./);
  await expect(getButton(page)).toBeHidden();
  expect(await page.evaluate(() => window.__quoin.set.state)).toBe('done');
  expect(await page.evaluate(() => window.__quoin.preview)).toBe(null);
  expect(problems).toEqual([]);
});

test('fable get: the table after Get is the report and names each output', async ({ page }) => {
  await previewed(page, twoBooks, injectReplace);
  const [download] = await Promise.all([page.waitForEvent('download'), getButton(page).click()]);
  await download.path();
  await expect(matrix(page).locator('.grid-hcell .hname')).toHaveText(['File', 'Unit', 'Action', 'Compute', 'Changed', 'Reason', 'Old hash', 'New hash']);
  await expect(matrix(page).locator('.grid-row', { hasText: 'a.xlsx' }).first()).toContainText('Yes');
});

test('fable get: a signed project asks once for the whole set, naming the count, and Go back changes nothing', async ({ page }) => {
  await previewed(page, [['signed.xlsm', fx('signed.xlsm')], ['mixed.xlsm', fx('mixed.xlsm')]], moduleReplace);
  await expect(panel(page).locator('.recipe-notes')).toContainText('1 file has a signed macro project. Running removes the signature.');
  let downloads = 0;
  page.on('download', () => downloads++);
  await getButton(page).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('1 workbook has a signed macro project.');
  await dialog.getByRole('button', { name: 'Go back' }).click();
  await expect(dialog).toHaveCount(0);
  expect(downloads).toBe(0);
  expect(await page.evaluate(() => window.__quoin.set.state)).toBe('ready');
  await expect(getButton(page)).toBeVisible();
  await getButton(page).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog').getByRole('button', { name: 'Remove and get' }).click()]);
  const entries = await zipOf(download);
  const rows = csvOf(entries.get('report.csv'));
  const col = rows[0].indexOf('signature_removed');
  expect(rows.slice(1).map((r) => r[col])).toContain('yes');
  expect([...entries.keys()]).toContain('books/signed.xlsm');
});

test('fable get: a set with no signed project does not ask', async ({ page }) => {
  await previewed(page, twoBooks, injectReplace);
  const [download] = await Promise.all([page.waitForEvent('download'), getButton(page).click()]);
  await download.path();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('fable get: adding files after a preview takes Get away, so a stale plan cannot be run', async ({ page }) => {
  await previewed(page, twoBooks, injectReplace);
  await expect(getButton(page)).toBeVisible();
  await dropTree(page, [{ name: 'more', children: [{ name: 'extra.xlsx', data: b64(ext('pq_simple.xlsx')) }] }]);
  await waitForSet(page);
  await expect(getButton(page)).toBeHidden();
  await expect(folderButton(page)).toBeHidden();
});

test('fable get: into a folder writes the workbooks and report.csv through the picker and never opens an existing file', async ({ page }) => {
  await page.addInitScript(() => {
    const log = [];
    const files = {};
    const make = (path, existing = {}) => ({
      name: path.split('/').pop() || 'out',
      async getDirectoryHandle(name) {
        return make(`${path}/${name}`, existing);
      },
      async getFileHandle(name, opts) {
        const full = `${path}/${name}`;
        if (!(full in files) && !opts) throw Object.assign(new Error('x'), { name: 'NotFoundError' });
        return {
          async createWritable() {
            log.push(full);
            let staged = null;
            return { async write(d) { staged = new Uint8Array(d); }, async close() { files[full] = staged; }, async abort() {} };
          },
          async getFile() {
            const b = files[full];
            return { arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) };
          }
        };
      },
      async removeEntry() {}
    });
    files['out/books/a.xlsx'] = new Uint8Array([1]);
    window.__written = { log, files };
    window.showDirectoryPicker = async () => make('out');
  });
  await previewed(page, [['a.xlsx', ext('pq_simple.xlsx')], ['mixed.xlsm', fx('mixed.xlsm')]], injectReplace);
  await folderButton(page).click();
  await expect(panel(page).locator('.recipe-notes')).toContainText('Wrote 1 workbook and report.csv to out.');
  const written = await page.evaluate(() => ({ log: window.__written.log, original: Array.from(window.__written.files['out/books/a.xlsx']), names: Object.keys(window.__written.files).sort() }));
  expect(written.log).toEqual(['out/books/a-2.xlsx', 'out/report.csv']);
  expect(written.original).toEqual([1]);
  expect(written.names).toEqual(['out/books/a-2.xlsx', 'out/books/a.xlsx', 'out/report.csv']);
  expect(await page.evaluate(() => window.__quoin.set.state)).toBe('done');
});

test('fable get: closing the folder picker writes nothing and keeps the preview', async ({ page }) => {
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => {
      throw Object.assign(new Error('closed'), { name: 'AbortError' });
    };
  });
  await previewed(page, twoBooks, injectReplace);
  await folderButton(page).click();
  await expect(getButton(page)).toBeVisible();
  expect(await page.evaluate(() => window.__quoin.set.state)).toBe('ready');
  await expect(panel(page).locator('.recipe-error')).toBeHidden();
});

test('fable get: a folder that cannot be opened says so and keeps the preview', async ({ page }) => {
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => {
      throw Object.assign(new Error('blocked'), { name: 'SecurityError' });
    };
  });
  await previewed(page, twoBooks, injectReplace);
  await folderButton(page).click();
  await expect(panel(page).locator('.recipe-error')).toHaveText('The folder could not be opened. Nothing was written.');
  await expect(getButton(page)).toBeVisible();
  expect(await page.evaluate(() => window.__quoin.set.state)).toBe('ready');
});

test('fable get: the folder button is not shown where the browser has no folder picker', async ({ page }) => {
  await page.addInitScript(() => {
    delete window.showDirectoryPicker;
  });
  await previewed(page, twoBooks, injectReplace);
  await expect(getButton(page)).toBeVisible();
  await expect(folderButton(page)).toBeHidden();
});

test('fable get: from the keyboard, Get downloads and focus returns to Preview', async ({ page }) => {
  await previewed(page, twoBooks, injectReplace);
  await getButton(page).focus();
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
  await download.path();
  await expect(previewButton(page)).toBeFocused();
});
