import { test, expect } from '@playwright/test';
import { openWorkbook } from '../../src/core/workbook.js';
import { readUsedGrid } from '../../src/core/cells.js';
import { ext, fx } from './helpers.js';
import { previewed, getButton, folderButton, matrix, panel, zipOf, sha, csvOf } from './fable-batch.js';

const CURRENT = 'Excel.CurrentWorkbook(){[Name="{unit.name}"]}[Content]';
const combined = { recipe: 'transform', v: 1, scope: { type: 'tables', match: 'all' }, query: { source: 'inline', m: CURRENT }, output: { mode: 'combined' } };
const books = [['pq_simple.xlsx', ext('pq_simple.xlsx')], ['mixed.xlsm', fx('mixed.xlsm')]];
const SHEETS = ['mixed__FinalTable', 'mixed__RawInput', 'pq_simple__StudentNames', 'pq_simple__StudentResults'];

async function getZip(page) {
  await page.waitForTimeout(1200);
  const [download] = await Promise.all([page.waitForEvent('download'), getButton(page).click()]);
  return zipOf(download);
}

test('fable transform combined: Preview names the shared workbook and each unit sheet, and keeps no sheet data', async ({ page }) => {
  const problems = await previewed(page, books, combined);
  const rows = await page.evaluate(() => window.__quoin.preview.rows.map((r) => [r.file, r.unit, r.verdict, r.output]));
  expect(rows).toEqual([
    ['mixed.xlsm', 'FinalTable', 'changed', 'Combined.xlsx [mixed__FinalTable]'],
    ['mixed.xlsm', 'RawInput', 'changed', 'Combined.xlsx [mixed__RawInput]'],
    ['pq_simple.xlsx', 'StudentNames', 'changed', 'Combined.xlsx [pq_simple__StudentNames]'],
    ['pq_simple.xlsx', 'StudentResults', 'changed', 'Combined.xlsx [pq_simple__StudentResults]']
  ]);
  await expect(panel(page).locator('.recipe-notes')).toContainText('4 would change');
  await expect(getButton(page)).toBeVisible();
  const held = await page.evaluate(() => [...window.__quoin.preview.perFile.values()].map((h) => [h.bytes, h.outputs.length, h.sheetParts.length]));
  expect(held).toEqual([[null, 0, 0], [null, 0, 0]]);
  expect(problems).toEqual([]);
});

test('fable transform combined: picking a row says it joins Combined.xlsx and names its sheet', async ({ page }) => {
  await previewed(page, [['pq_simple.xlsx', ext('pq_simple.xlsx')]], combined);
  const region = page.locator('.set-detail').getByRole('region');
  await matrix(page).locator('.grid-row').first().locator('.grid-cell:not(.grid-index)').first().click();
  await expect(region).toHaveAttribute('aria-label', 'Output for StudentNames');
  await expect(region).toContainText('Writes Combined.xlsx, one workbook with a sheet for every unit; the sheet pq_simple__StudentNames holds the values of StudentNames.');
});

test('fable transform combined: Get downloads one Combined.xlsx with a sheet per unit, and the report names its path, sheet and hash', async ({ page }) => {
  await previewed(page, books, combined);
  const entries = await getZip(page);
  expect([...entries.keys()].sort()).toEqual(['Combined.xlsx', 'report.csv']);
  const wb = await openWorkbook(entries.get('Combined.xlsx'), 'Combined.xlsx');
  expect(wb.sheets.map((s) => s.name)).toEqual(SHEETS);
  expect((await readUsedGrid(wb, 'pq_simple__StudentNames')).map((row) => row.map((c) => c.v))).toEqual([['Name', 'Age'], ['Alice', 30], ['Bob', 25], ['Charlie', 35]]);
  const report = csvOf(entries.get('report.csv'));
  const col = (name) => report[0].indexOf(name);
  expect(report.slice(1).map((r) => [r[col('unit')], r[col('verdict')], r[col('output')], r[col('new_hash')], r[col('verified')]])).toEqual(
    ['FinalTable', 'RawInput', 'StudentNames', 'StudentResults'].map((unit, i) => [unit, 'changed', `Combined.xlsx [${SHEETS[i]}]`, sha(entries.get('Combined.xlsx')), 'yes'])
  );
  await expect(panel(page).locator('.recipe-notes')).toContainText('Downloaded Transform');
});

test('fable transform combined: Get into a folder writes Combined.xlsx at the root of the folder, then report.csv', async ({ page }) => {
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
  await previewed(page, books, combined);
  await folderButton(page).click();
  await expect(panel(page).locator('.recipe-notes')).toContainText('Wrote 1 workbook and report.csv to out.');
  expect(await page.evaluate(() => window.__written.log)).toEqual(['out/Combined.xlsx', 'out/report.csv']);
});
