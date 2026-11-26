import { test, expect } from '@playwright/test';
import { openWorkbook } from '../../src/core/workbook.js';
import { readUsedGrid } from '../../src/core/cells.js';
import { openSet, give, previewButton, getButton, matrix, panel, zipOf, sha, csvOf } from './fable-batch.js';
import { workedExampleFiles, workedRecipe, PINNED, MISSING_COLUMN } from '../fixtures/worked-example.js';

const grid = async (wb, name) => (await readUsedGrid(wb, name)).map((row) => row.map((c) => c.v));

test('fable worked example: twelve workbooks in, ten in the zip, every number of section 9', async ({ page }) => {
  const sources = await workedExampleFiles();
  const problems = await openSet(page, sources.map(([name, bytes]) => [name, null, Buffer.from(bytes).toString('base64')]));

  const set = await page.evaluate(() => window.__quoin.set.list().map((f) => [f.name, f.badge]));
  expect(set).toHaveLength(12);
  expect(set.filter(([, badge]) => badge === 'skipped').map(([name]) => name)).toEqual(['old-11.xls', 'old-12.xls']);
  expect(set.filter(([, badge]) => badge === 'ready')).toHaveLength(10);

  await give(page, workedRecipe());
  await previewButton(page).click();
  await expect(matrix(page)).toBeVisible();
  const notes = panel(page).locator('.recipe-notes');
  await expect(notes).toContainText('7 files → 1 unit each, 3 files → 2 units each — 13 units across 10 files');
  await expect(notes).toContainText('11 would change · 2 skipped · 2 refused');

  const rows = await page.evaluate(() => window.__quoin.preview.rows.map((r) => ({ file: r.file, unit: r.unit, verdict: r.verdict, code: r.reason_code, reason: r.reason, output: r.output })));
  const unitRows = rows.filter((r) => r.unit !== '');
  expect(unitRows).toHaveLength(13);
  expect(unitRows.filter((r) => r.verdict === 'changed')).toHaveLength(11);
  const skipped = unitRows.filter((r) => r.verdict === 'skipped');
  expect(skipped.map((r) => [r.file, r.unit, r.code, r.reason])).toEqual(MISSING_COLUMN.map((file) => [file, 'South', 'skip.missingColumn', "The column 'Amount' of the table wasn't found."]));
  expect(unitRows.filter((r) => PINNED.includes(r.file)).map((r) => r.unit)).toEqual(['Data', 'Data', 'Data']);
  const perFile = new Map();
  for (const r of unitRows) perFile.set(r.file, (perFile.get(r.file) || 0) + 1);
  expect([...perFile.values()].filter((n) => n === 1)).toHaveLength(7);
  expect([...perFile.values()].filter((n) => n === 2)).toHaveLength(3);
  expect(rows.filter((r) => r.verdict === 'refused').map((r) => [r.file, r.code])).toEqual([['old-11.xls', 'file.unsupportedExtension'], ['old-12.xls', 'file.unsupportedExtension']]);

  const hashes = await page.evaluate(() => [...window.__quoin.preview.perFile].map(([id, held]) => [window.__quoin.preview.indexes.find((i) => i.id === id).name, held.outputs.map((o) => [o.name, o.sha256])]));
  await page.waitForTimeout(1200);
  const [download] = await Promise.all([page.waitForEvent('download'), getButton(page).click()]);
  const entries = await zipOf(download);

  const workbooks = [...entries.keys()].filter((n) => n !== 'report.csv').sort();
  expect(workbooks).toEqual(Array.from({ length: 10 }, (_, i) => `books/sales-${String(i + 1).padStart(2, '0')} (edited).xlsx`));
  for (const [file, outputs] of hashes) for (const [name, hash] of outputs) expect(sha(entries.get(`books/${name}`)), `${file} ${name}`).toBe(hash);

  const report = csvOf(entries.get('report.csv'));
  const col = (name) => report[0].indexOf(name);
  const body = report.slice(1);
  expect(body).toHaveLength(15);
  const verdicts = body.map((r) => r[col('verdict')]);
  expect(verdicts.filter((v) => v === 'changed')).toHaveLength(11);
  expect(verdicts.filter((v) => v === 'skipped')).toHaveLength(2);
  expect(verdicts.filter((v) => v === 'refused')).toHaveLength(2);
  expect(body.filter((r) => r[col('verdict')] === 'changed').every((r) => r[col('verified')] === 'yes')).toBe(true);
  expect(body.filter((r) => r[col('verdict')] === 'changed').map((r) => r[col('output')])).toContain('books/sales-08 (edited).xlsx [Clean-2]');

  for (const [name, bytes] of sources.filter(([n]) => n.endsWith('.xlsx'))) {
    const source = await openWorkbook(new Uint8Array(bytes), name);
    const copy = await openWorkbook(entries.get(`books/${name.replace('.xlsx', ' (edited).xlsx')}`), 'copy.xlsx');
    const added = name === 'sales-08.xlsx' ? ['Clean', 'Clean-2'] : ['Clean'];
    expect(copy.sheets.map((s) => s.name), name).toEqual([...source.sheets.map((s) => s.name), ...added]);
    for (const s of source.sheets) expect(await grid(copy, s.name), `${name} ${s.name}`).toEqual(await grid(source, s.name));
    const clean = await grid(copy, 'Clean');
    expect(clean[0], name).toEqual(['Region', 'Amount']);
    expect(clean, name).toHaveLength(4);
  }
  expect(problems).toEqual([]);
});
