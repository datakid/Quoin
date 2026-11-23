import { test, expect } from '@playwright/test';
import { ext, fx } from './helpers.js';
import { NEW_M, inject, give, openSet, previewButton, getButton, matrix, zipOf, sha, csvOf, indexOf, previewState } from './fable-batch.js';

const books = [['mixed.xlsm', fx('mixed.xlsm')], ['pq_simple.xlsx', ext('pq_simple.xlsx')], ['pq_vba_complex.xlsm', ext('pq_vba_complex.xlsm')]];

const cases = [
  ['replace in code', () => ({ recipe: 'replace', v: 1, replace: { in: ['m', 'vba'], find: 'DateTime', with: 'MyDateTime', kind: 'text', matchCase: true } })],
  ['inject: replace a query', () => inject({ target: 'query', op: 'replace', name: 'StudentResults', text: NEW_M })],
  ['inject: replace a query by pattern', () => inject({ target: 'query', op: 'replace', match: 'pattern', name: 'Raw*', text: NEW_M })],
  ['inject: add a query', () => inject({ target: 'query', op: 'add', name: 'Added', text: NEW_M })],
  ['inject: replace a module', () => inject({ target: 'module', op: 'replace', name: 'Module1', text: 'Sub A()\r\nEnd Sub\r\n' })],
  ['inject: add a module', () => inject({ target: 'module', op: 'add', name: 'ModNew', text: 'Sub A()\r\nEnd Sub\r\n' })],
  ['inject: remove a module', () => inject({ target: 'module', op: 'remove', name: 'Module1' })]
];

async function planAndGet(page, recipe) {
  await openSet(page, books);
  await give(page, recipe);
  await previewButton(page).click();
  await expect(matrix(page)).toBeVisible();
  const plan = await previewState(page);
  expect(plan.signedCount).toBe(0);
  expect(plan.counts.changed).toBeGreaterThan(0);
  await page.waitForTimeout(1200);
  const [download] = await Promise.all([page.waitForEvent('download'), getButton(page).click()]);
  return { plan, entries: await zipOf(download) };
}

for (const [name, build] of cases) {
  test(`fable plan equals run: ${name}, every released file hashes exactly as its preview said`, async ({ page }) => {
    const { plan, entries } = await planAndGet(page, build());
    expect(plan.hashes.length).toBeGreaterThan(0);
    expect([...entries.keys()].filter((k) => k !== 'report.csv').sort()).toEqual(plan.hashes.map(([p]) => p).sort());
    for (const [path, hash] of plan.hashes) expect(sha(entries.get(path)), path).toBe(hash);
    const changedFiles = [...new Set(plan.rows.filter((r) => r.verdict === 'changed').map((r) => `${r.folder}${r.file}`))].sort();
    expect(plan.hashes.map(([p]) => p).sort()).toEqual(changedFiles);
    const rows = csvOf(entries.get('report.csv'));
    const verdict = rows[0].indexOf('verdict');
    expect(rows.slice(1).filter((r) => r[verdict] === 'changed').length).toBe(plan.rows.filter((r) => r.verdict === 'changed').length);
    expect(rows.slice(1).some((r) => r[verdict] === 'not-released')).toBe(false);
  });
}

test('fable plan equals run: align makes every file carry the chosen version and the zip holds only the files that differed', async ({ page }) => {
  await openSet(page, books);
  const indexes = await indexOf(page);
  const mixed = indexes.find((i) => i.relPath === 'books/mixed.xlsm');
  const complex = indexes.find((i) => i.relPath === 'books/pq_vba_complex.xlsm');
  const chosen = mixed.modules.find((m) => m.name === 'ThisWorkbook').hash;
  expect(complex.modules.find((m) => m.name === 'ThisWorkbook').hash).not.toBe(chosen);
  await give(page, { recipe: 'align', v: 1, align: { target: 'module', name: 'ThisWorkbook', hash: chosen } });
  await previewButton(page).click();
  await expect(matrix(page)).toBeVisible();
  const plan = await previewState(page);
  expect(plan.rows.filter((r) => r.verdict === 'changed').map((r) => r.file)).toEqual(['pq_vba_complex.xlsm']);
  await page.waitForTimeout(1200);
  const [download] = await Promise.all([page.waitForEvent('download'), getButton(page).click()]);
  const entries = await zipOf(download);
  expect([...entries.keys()].sort()).toEqual(['books/pq_vba_complex.xlsm', 'report.csv']);
  expect(sha(entries.get('books/pq_vba_complex.xlsm'))).toBe(plan.hashes[0][1]);
});
