import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { Package } from '../../src/core/opc.js';
import { readZip } from '../../src/core/zip-read.js';
import { openWorkbook } from '../../src/core/workbook.js';
import { readUsedGrid } from '../../src/core/cells.js';
import { ext, fx } from './helpers.js';
import { previewed, getButton, matrix, panel, zipOf, sha, csvOf } from './fable-batch.js';

const CURRENT = 'Excel.CurrentWorkbook(){[Name="{unit.name}"]}[Content]';
const newSheet = { recipe: 'transform', v: 1, scope: { type: 'tables', match: 'all' }, query: { source: 'inline', m: CURRENT }, output: { mode: 'newSheet' } };
const books = [['pq_simple.xlsx', ext('pq_simple.xlsx')], ['mixed.xlsm', fx('mixed.xlsm')]];

const outputsOf = (page) => page.evaluate(() => {
  const p = window.__quoin.preview;
  return [...p.perFile].map(([id, held]) => [p.indexes.find((i) => i.id === id).relPath, held.outputs.map((o) => ({ name: o.name, sha256: o.sha256, hasBytes: o.bytes !== undefined && o.bytes !== null }))]);
});

async function getZip(page) {
  await page.waitForTimeout(1200);
  const [download] = await Promise.all([page.waitForEvent('download'), getButton(page).click()]);
  return zipOf(download);
}

test('fable transform new sheet: Preview has a row per unit naming the copy and the new sheet, and keeps no bytes', async ({ page }) => {
  const problems = await previewed(page, books, newSheet);
  const rows = await page.evaluate(() => window.__quoin.preview.rows.map((r) => [r.file, r.unit, r.verdict, r.output]));
  expect(rows).toEqual([
    ['mixed.xlsm', 'FinalTable', 'changed', 'mixed (edited).xlsm [Result]'],
    ['mixed.xlsm', 'RawInput', 'changed', 'mixed (edited).xlsm [Result-2]'],
    ['pq_simple.xlsx', 'StudentNames', 'changed', 'pq_simple (edited).xlsx [Result]'],
    ['pq_simple.xlsx', 'StudentResults', 'changed', 'pq_simple (edited).xlsx [Result-2]']
  ]);
  await expect(panel(page).locator('.recipe-notes')).toContainText('4 would change');
  await expect(getButton(page)).toBeVisible();
  for (const [, outputs] of await outputsOf(page)) {
    expect(outputs).toHaveLength(1);
    expect(outputs[0].hasBytes).toBe(false);
  }
  expect(problems).toEqual([]);
});

test('fable transform new sheet: picking a row says which copy it would write and which sheet holds the unit', async ({ page }) => {
  await previewed(page, [['pq_simple.xlsx', ext('pq_simple.xlsx')]], newSheet);
  const region = page.locator('.set-detail').getByRole('region');
  await matrix(page).locator('.grid-row').first().locator('.grid-cell:not(.grid-index)').first().click();
  await expect(region).toHaveAttribute('aria-label', 'Output for StudentNames');
  await expect(region).toContainText('Writes books/pq_simple (edited).xlsx, a copy of the workbook with a new sheet, Result, holding the values of StudentNames.');
  await matrix(page).locator('.grid-row').nth(1).locator('.grid-cell:not(.grid-index)').first().click();
  await expect(region).toContainText('a new sheet, Result-2, holding the values of StudentResults.');
});

test('fable transform new sheet: Get downloads one copy per workbook, each exactly what the preview hashed, and not the sources', async ({ page }) => {
  await previewed(page, books, newSheet);
  const outputs = await outputsOf(page);
  const entries = await getZip(page);
  const expected = outputs.flatMap(([path, list]) => list.map((o) => [`${path.slice(0, path.lastIndexOf('/') + 1)}${o.name}`, o.sha256]));
  expect([...entries.keys()].sort()).toEqual(['report.csv', ...expected.map(([p]) => p)].sort());
  for (const [path, hash] of expected) expect(sha(entries.get(path)), path).toBe(hash);
  const report = csvOf(entries.get('report.csv'));
  const col = (name) => report[0].indexOf(name);
  expect(report.slice(1).map((r) => [r[col('unit')], r[col('verdict')], r[col('output')]]).sort()).toEqual([
    ['FinalTable', 'changed', 'books/mixed (edited).xlsm [Result]'],
    ['RawInput', 'changed', 'books/mixed (edited).xlsm [Result-2]'],
    ['StudentNames', 'changed', 'books/pq_simple (edited).xlsx [Result]'],
    ['StudentResults', 'changed', 'books/pq_simple (edited).xlsx [Result-2]']
  ]);
  await expect(panel(page).locator('.recipe-notes')).toContainText('Downloaded Transform');
});

test('fable transform new sheet: a released copy keeps every sheet of its source and adds one per unit holding that unit table', async ({ page }) => {
  await previewed(page, [['pq_simple.xlsx', ext('pq_simple.xlsx')]], newSheet);
  const entries = await getZip(page);
  const source = await openWorkbook(new Uint8Array(readFileSync(ext('pq_simple.xlsx'))), 'pq_simple.xlsx');
  const copy = await openWorkbook(entries.get('books/pq_simple (edited).xlsx'), 'copy.xlsx');
  expect(copy.sheets.map((s) => s.name)).toEqual([...source.sheets.map((s) => s.name), 'Result', 'Result-2']);
  expect((await readUsedGrid(copy, 'Result')).map((row) => row.map((c) => c.v))).toEqual([['Name', 'Age'], ['Alice', 30], ['Bob', 25], ['Charlie', 35]]);
  const results = (await readUsedGrid(copy, 'Result-2')).map((row) => row.map((c) => c.v));
  expect(results.slice(0, 2)).toEqual([['Name', 'Age', 'DateTimeGenerated'], ['Alice', 30, expect.any(Number)]]);
  for (const s of source.sheets) {
    const before = (await readUsedGrid(source, s.name)).map((row) => row.map((c) => c.v));
    const after = (await readUsedGrid(copy, s.name)).map((row) => row.map((c) => c.v));
    expect(after, s.name).toEqual(before);
  }
});

test('fable transform new sheet: a macro workbook copy keeps its VBA project', async ({ page }) => {
  await previewed(page, [['mixed.xlsm', fx('mixed.xlsm')]], newSheet);
  const entries = await getZip(page);
  const copy = new Package(readZip(entries.get('books/mixed (edited).xlsm')));
  const source = new Package(readZip(new Uint8Array(readFileSync(fx('mixed.xlsm')))));
  const part = copy.has('xl/vbaProject.bin');
  expect(source.has('xl/vbaProject.bin')).toBe(true);
  expect(Array.from(await copy.bytes('xl/vbaProject.bin'))).toEqual(Array.from(await source.bytes('xl/vbaProject.bin')));
  expect(part).toBe(true);
});
