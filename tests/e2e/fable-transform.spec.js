import { test, expect } from '@playwright/test';
import { openWorkbook } from '../../src/core/workbook.js';
import { readUsedGrid } from '../../src/core/cells.js';
import { ext, fx } from './helpers.js';
import { give, openSet, previewed, previewButton, getButton, folderButton, matrix, panel, zipOf, sha, csvOf } from './fable-batch.js';

const CURRENT = 'Excel.CurrentWorkbook(){[Name="{unit.name}"]}[Content]';
const transform = (output, extra = {}) => ({ recipe: 'transform', v: 1, scope: { type: 'tables', match: 'all' }, query: { source: 'inline', m: CURRENT }, output, ...extra });
const newFile = transform({ mode: 'newFile' });
const books = [['pq_simple.xlsx', ext('pq_simple.xlsx')], ['mixed.xlsm', fx('mixed.xlsm')]];

const outputsOf = (page) => page.evaluate(() => {
  const p = window.__quoin.preview;
  return [...p.perFile].map(([id, held]) => [p.indexes.find((i) => i.id === id).relPath, held.outputs.map((o) => ({ name: o.name, sha256: o.sha256, hasBytes: o.bytes !== undefined && o.bytes !== null }))]);
});

const gridOf = async (bytes) => {
  const wb = await openWorkbook(bytes, 'output.xlsx');
  return { sheets: wb.sheets.map((s) => s.name), cells: (await readUsedGrid(wb, 'Result')).map((row) => row.map((c) => c.v)) };
};

async function getZip(page) {
  await page.waitForTimeout(1200);
  const [download] = await Promise.all([page.waitForEvent('download'), getButton(page).click()]);
  return zipOf(download);
}

test('fable transform: Preview lists a row for every unit with the file it would write, and writes nothing', async ({ page }) => {
  const problems = await previewed(page, books, newFile);
  const rows = await page.evaluate(() => window.__quoin.preview.rows.map((r) => [r.file, r.unit, r.verdict, r.output, r.compute]));
  expect(rows.map((r) => r.slice(0, 4))).toEqual([
    ['mixed.xlsm', 'FinalTable', 'changed', 'mixed__FinalTable.xlsx'],
    ['mixed.xlsm', 'RawInput', 'changed', 'mixed__RawInput.xlsx'],
    ['pq_simple.xlsx', 'StudentNames', 'changed', 'pq_simple__StudentNames.xlsx'],
    ['pq_simple.xlsx', 'StudentResults', 'changed', 'pq_simple__StudentResults.xlsx']
  ]);
  await expect(panel(page).locator('.recipe-notes')).toContainText('4 would change');
  await expect(getButton(page)).toBeVisible();
  for (const [, outputs] of await outputsOf(page)) for (const o of outputs) expect(o.hasBytes, `${o.name} keeps no bytes in a preview`).toBe(false);
  expect(problems).toEqual([]);
});

test('fable transform: picking a row says which file it would write', async ({ page }) => {
  await previewed(page, [['pq_simple.xlsx', ext('pq_simple.xlsx')]], newFile);
  const detail = page.locator('.set-detail');
  await expect(detail).toContainText('Select a row to see what changes.');
  await matrix(page).locator('.grid-row').first().locator('.grid-cell:not(.grid-index)').first().click();
  const region = detail.getByRole('region');
  await expect(region).toHaveAttribute('aria-label', 'Output for StudentNames');
  await expect(region).toContainText('Transform · StudentNames · books/pq_simple.xlsx');
  await expect(region).toContainText('Writes books/pq_simple__StudentNames.xlsx, a workbook with one sheet, Result, holding the values of StudentNames.');
  await matrix(page).locator('.grid-row').nth(1).locator('.grid-cell:not(.grid-index)').first().click();
  await expect(region).toContainText('Writes books/pq_simple__StudentResults.xlsx');
});

test('fable transform: Get downloads one workbook per unit and each is exactly what the preview hashed', async ({ page }) => {
  await previewed(page, books, newFile);
  const outputs = await outputsOf(page);
  const entries = await getZip(page);
  const expected = outputs.flatMap(([path, list]) => list.map((o) => [`${path.slice(0, path.lastIndexOf('/') + 1)}${o.name}`, o.sha256]));
  expect([...entries.keys()].filter((k) => k !== 'report.csv').sort()).toEqual(expected.map(([p]) => p).sort());
  for (const [path, hash] of expected) expect(sha(entries.get(path)), path).toBe(hash);
  const report = csvOf(entries.get('report.csv'));
  const col = (name) => report[0].indexOf(name);
  expect(report.slice(1).map((r) => [r[col('unit')], r[col('verdict')], r[col('output')]]).sort()).toEqual(expected.map(([p]) => p).map((p) => [p.split('__')[1].replace('.xlsx', ''), 'changed', p]).sort());
  await expect(panel(page).locator('.recipe-notes')).toContainText('Downloaded Transform');
});

test('fable transform: a released workbook has one sheet, Result, holding the unit table', async ({ page }) => {
  await previewed(page, [['pq_simple.xlsx', ext('pq_simple.xlsx')]], newFile);
  const entries = await getZip(page);
  const names = await gridOf(entries.get('books/pq_simple__StudentNames.xlsx'));
  expect(names.sheets).toEqual(['Result']);
  expect(names.cells).toEqual([['Name', 'Age'], ['Alice', 30], ['Bob', 25], ['Charlie', 35]]);
  const results = await gridOf(entries.get('books/pq_simple__StudentResults.xlsx'));
  expect(results.cells.slice(0, 2)).toEqual([['Name', 'Age', 'DateTimeGenerated'], ['Alice', 30, expect.any(Number)]]);
});

test('fable transform: the zip holds the unit workbooks and report.csv and nothing else, not the sources', async ({ page }) => {
  await previewed(page, [['pq_simple.xlsx', ext('pq_simple.xlsx')]], newFile);
  const entries = await getZip(page);
  expect([...entries.keys()].sort()).toEqual(['books/pq_simple__StudentNames.xlsx', 'books/pq_simple__StudentResults.xlsx', 'report.csv']);
});

test('fable transform: Get into a folder writes each unit workbook beside its source path, then report.csv', async ({ page }) => {
  await page.addInitScript(() => {
    const log = [];
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
    window.__written = { log, files };
    window.showDirectoryPicker = async () => make('out');
  });
  await previewed(page, [['pq_simple.xlsx', ext('pq_simple.xlsx')]], newFile);
  await folderButton(page).click();
  await expect(panel(page).locator('.recipe-notes')).toContainText('Wrote 2 workbooks and report.csv to out.');
  const log = await page.evaluate(() => window.__written.log);
  expect(log).toEqual(['out/books/pq_simple__StudentNames.xlsx', 'out/books/pq_simple__StudentResults.xlsx', 'out/report.csv']);
});

for (const [name, recipe, words] of [
  ['writes one combined workbook', transform({ mode: 'combined' }), 'one combined workbook cannot be previewed here yet. Only a new file for each unit, or a new sheet in a copy, can.'],
  ['writes the result in place', transform({ mode: 'inPlace', range: 'A1' }), 'the result in place cannot be previewed here yet. Only a new file for each unit, or a new sheet in a copy, can.'],
  ['lets Excel compute it', transform({ mode: 'newFile' }, { compute: 'excel' }), 'A recipe that Excel computes on open cannot be previewed here yet.']
]) {
  test(`fable transform: a recipe that ${name} says it cannot be previewed yet and offers no Preview`, async ({ page }) => {
    await openSet(page, books);
    await give(page, recipe);
    await expect(panel(page).locator('.recipe-notes')).toContainText(words);
    await expect(previewButton(page)).toBeDisabled();
    await expect(matrix(page)).toHaveCount(0);
  });
}
