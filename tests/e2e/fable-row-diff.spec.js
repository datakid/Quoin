import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ext, fx, openApp, dropTree, waitForSet } from './helpers.js';

const b64 = (path) => readFileSync(path).toString('base64');
const NEW_M = 'let\n    Source = 2\nin\n    Source';

const replaceCode = { recipe: 'replace', v: 1, replace: { in: ['m', 'vba'], find: 'DateTime', with: 'MyDateTime', kind: 'text', matchCase: true } };
const injectQuery = { recipe: 'inject', v: 1, inject: { target: 'query', op: 'replace', match: 'name', name: 'StudentResults', source: 'inline', text: NEW_M, refreshOnLoad: false } };
const moduleReplace = { recipe: 'inject', v: 1, inject: { target: 'module', op: 'replace', match: 'name', name: 'Module1', source: 'inline', text: 'Sub A()\r\nEnd Sub\r\n', refreshOnLoad: false } };

const recipeInput = (page) => page.locator('input[aria-label="Recipe file"]');
const matrix = (page) => page.getByRole('grid', { name: 'Run results' });
const previewButton = (page) => page.getByRole('button', { name: 'Preview', exact: true });
const detail = (page) => page.locator('.set-detail');
const diffRegion = (page) => detail(page).getByRole('region');

const give = (page, json) => recipeInput(page).setInputFiles({ name: 'my.quoin-recipe.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) });

async function previewed(page, recipe, files) {
  const problems = await openApp(page);
  await dropTree(page, [{ name: 'books', children: files.map(([name, path]) => ({ name, data: b64(path) })) }]);
  await waitForSet(page);
  await give(page, recipe);
  await previewButton(page).click();
  await expect(matrix(page)).toBeVisible();
  return problems;
}

const changedRows = (page) => matrix(page).locator('.grid-row').filter({ hasText: 'Yes' });
const firstCell = (row) => row.locator('.grid-cell:not(.grid-index)').first();

test('fable row diff: a preview asks for a row first, then shows exactly what changes in the row you pick', async ({ page }) => {
  const problems = await previewed(page, moduleReplace, [['signed.xlsm', fx('signed.xlsm')], ['mixed.xlsm', fx('mixed.xlsm')]]);
  await expect(detail(page)).toContainText('Select a row to see what changes.');
  await expect(diffRegion(page)).toHaveCount(0);
  await firstCell(changedRows(page).first()).click();
  await expect(diffRegion(page)).toHaveCount(1);
  await expect(diffRegion(page)).toHaveAttribute('aria-label', 'Changes to Module1');
  await expect(diffRegion(page)).toContainText('Replace · Module1 · books/');
  await expect(diffRegion(page).locator('tr.diff-add')).not.toHaveCount(0);
  await expect(diffRegion(page).locator('tr.diff-del')).not.toHaveCount(0);
  await expect(diffRegion(page).locator('tr.diff-add .diff-text').first()).toContainText('Sub A()');
  expect(problems).toEqual([]);
});

test('fable row diff: moving through the rows with the arrow keys follows the selection', async ({ page }) => {
  await previewed(page, replaceCode, [['mixed.xlsm', fx('mixed.xlsm')], ['pq_simple.xlsx', ext('pq_simple.xlsx')]]);
  const verdicts = await page.evaluate(() => window.__quoin.preview.rows.map((r) => r.verdict));
  expect(verdicts).toContain('changed');
  expect(verdicts).toContain('unchanged');
  await firstCell(matrix(page).locator('.grid-row').first()).click();
  await matrix(page).focus();
  for (let i = 0; i < verdicts.length; i++) {
    await expect.poll(() => page.evaluate(() => window.__quoin.shell.matrix.grid.active.r), { message: `active row before step ${i}` }).toBe(i);
    await expect(diffRegion(page), `diff area for row ${i} (${verdicts[i]})`).toHaveCount(verdicts[i] === 'changed' ? 1 : 0);
    await page.keyboard.press('ArrowDown');
  }
});

test('fable row diff: a row that does not change goes back to the hint', async ({ page }) => {
  await previewed(page, replaceCode, [['mixed.xlsm', fx('mixed.xlsm')], ['pq_simple.xlsx', ext('pq_simple.xlsx')]]);
  await firstCell(changedRows(page).first()).click();
  await expect(diffRegion(page)).toHaveCount(1);
  const unchanged = matrix(page).locator('.grid-row').filter({ hasNotText: 'Yes' }).first();
  await firstCell(unchanged).click();
  await expect(diffRegion(page)).toHaveCount(0);
  await expect(detail(page)).toContainText('Select a row to see what changes.');
});

test('fable row diff: the diff region is reachable and scrolls from the keyboard', async ({ page }) => {
  await previewed(page, moduleReplace, [['signed.xlsm', fx('signed.xlsm')], ['mixed.xlsm', fx('mixed.xlsm')]]);
  await firstCell(changedRows(page).first()).click();
  await diffRegion(page).focus();
  await expect(diffRegion(page)).toBeFocused();
  const scrolls = await diffRegion(page).evaluate((el) => getComputedStyle(el).overflowY);
  expect(['auto', 'scroll']).toContain(scrolls);
});

test('fable row diff: a query replacement shows the old and new M text', async ({ page }) => {
  await previewed(page, injectQuery, [['pq_simple.xlsx', ext('pq_simple.xlsx')], ['mixed.xlsm', fx('mixed.xlsm')]]);
  const rows = changedRows(page);
  await expect(rows.first()).toBeVisible();
  await firstCell(rows.first()).click();
  await expect(diffRegion(page)).toHaveAttribute('aria-label', 'Changes to StudentResults');
  await expect(diffRegion(page).locator('tr.diff-add .diff-text', { hasText: 'Source = 2' })).toHaveCount(1);
});

test('fable row diff: removing the recipe or adding files clears the diff with the preview', async ({ page }) => {
  await previewed(page, moduleReplace, [['signed.xlsm', fx('signed.xlsm')], ['mixed.xlsm', fx('mixed.xlsm')]]);
  await firstCell(changedRows(page).first()).click();
  await expect(diffRegion(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Remove recipe' }).click();
  await expect(matrix(page)).toHaveCount(0);
  await expect(detail(page)).toHaveCount(0);
});

test('fable row diff: the result of Get is a report and has no diff area', async ({ page }) => {
  await previewed(page, moduleReplace, [['signed.xlsm', fx('signed.xlsm')], ['mixed.xlsm', fx('mixed.xlsm')]]);
  await firstCell(changedRows(page).first()).click();
  await expect(diffRegion(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Get', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Remove and get' }).click()]);
  await download.path();
  await expect(matrix(page)).toBeVisible();
  await expect(detail(page)).toBeHidden();
  await expect(diffRegion(page)).toHaveCount(0);
});

test('fable row diff: on a phone the panes stack without covering each other and the result and diff come into view', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  await dropTree(page, [{ name: 'books', children: [['signed.xlsm', fx('signed.xlsm')], ['mixed.xlsm', fx('mixed.xlsm')]].map(([name, path]) => ({ name, data: b64(path) })) }]);
  await waitForSet(page);
  await give(page, moduleReplace);
  const layout = () => page.evaluate(() => {
    const box = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, spill: e.scrollHeight - e.clientHeight }; };
    return { shell: box('.set-shell'), files: box('.set-files'), recipe: box('.set-recipe'), result: box('.set-result'), detail: box('.set-detail'), sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  const stacked = (l) => {
    expect(l.sideways).toBeLessThanOrEqual(0);
    expect(l.files.spill).toBeLessThanOrEqual(1);
    expect(l.recipe.spill).toBeLessThanOrEqual(1);
    expect(l.files.bottom).toBeLessThanOrEqual(l.recipe.top + 1);
    expect(l.recipe.bottom).toBeLessThanOrEqual(l.result.top + 1);
  };
  const inside = (l, part) => {
    expect(l[part].top).toBeGreaterThanOrEqual(l.shell.top - 1);
    expect(l[part].bottom).toBeLessThanOrEqual(l.shell.bottom + 1);
  };
  stacked(await layout());
  await previewButton(page).click();
  await expect(matrix(page)).toBeVisible();
  const previewed = await layout();
  stacked(previewed);
  inside(previewed, 'result');
  await firstCell(changedRows(page).first()).click();
  await expect(diffRegion(page)).toHaveCount(1);
  const picked = await layout();
  stacked(picked);
  inside(picked, 'detail');
  expect(picked.detail.bottom - picked.detail.top).toBeGreaterThan(40);
  expect(picked.result.bottom - picked.result.top).toBeGreaterThan(300);
});

test('fable row diff: a click on a cell repaints the table once and leaves drag mode', async ({ page }) => {
  await previewed(page, replaceCode, [['mixed.xlsm', fx('mixed.xlsm')], ['pq_simple.xlsx', ext('pq_simple.xlsx')]]);
  await page.evaluate(() => {
    window.__rebuilds = 0;
    new MutationObserver((list) => { window.__rebuilds += list.length; }).observe(document.querySelector('.grid-body'), { childList: true, subtree: true });
  });
  await firstCell(changedRows(page).first()).click();
  await page.waitForTimeout(300);
  const settled = await page.evaluate(() => window.__rebuilds);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__rebuilds)).toBe(settled);
  expect(await page.evaluate(() => window.__quoin.shell.matrix.grid.drag)).toBe(false);
});
