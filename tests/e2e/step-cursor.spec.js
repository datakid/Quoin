import { test, expect } from '@playwright/test';
import { ext, openApp, loadFile, editor } from './helpers.js';

async function openSimple(page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  const problems = await openApp(page);
  await loadFile(page, ext('pq_simple.xlsx'));
  await page.locator('[role=treeitem][data-name="StudentResults"]').click();
  return problems;
}

const caretAfter = (page, needle) => page.evaluate((needle) => {
  const ta = document.querySelector('.editor-wrap textarea');
  const at = ta.value.indexOf(needle) + needle.length;
  ta.focus();
  ta.setSelectionRange(at, at);
}, needle);

test('T-WB-14: the gutter band follows the step cursor and a gutter click moves it', async ({ page }) => {
  const problems = await openSimple(page);
  await expect(page.locator('.gutter .gutter-step-start')).toHaveAttribute('data-line', '4');
  await page.locator('.gutter [data-line="2"]').click();
  await expect(page.locator('.gutter .gutter-step-start')).toHaveAttribute('data-line', '2');
  expect(problems).toEqual([]);
});

test('T-WB-14: the caret moves the shown step after 600 ms with Follow caret on', async ({ page }) => {
  await openSimple(page);
  await page.getByRole('button', { name: 'Evaluate steps' }).click();
  await expect(page.getByRole('button', { name: /^Ran Added Custom/ })).toBeVisible();
  await expect(page.locator('.result-head')).toContainText('step 3 of 3');
  await editor(page).press('Control+Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.result-head')).toContainText('step 2 of 3', { timeout: 4000 });
});

test('T-WB-14: a function query gets an Invoke form and keeps its arguments', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const problems = await openApp(page);
  await loadFile(page, ext('pq_vba_complex.xlsm'));
  await page.locator('[role=treeitem][data-name="fGetNamedRange"]').click();
  await editor(page).fill('(x as number, y as text) as table => #table({"V"}, {{Text.From(x) & y}})');
  await expect(page.locator('.invoke-item')).toBeVisible();
  await page.locator('.invoke-input[type=number]').fill('2');
  await page.locator('.invoke-input[type=text]').fill('ab');
  await page.getByRole('button', { name: 'Invoke', exact: true }).click();
  await expect(page.locator('.grid-cell:not(.grid-index)').first()).toHaveText('2ab');
  await expect(page.locator('.invoke-input[type=number]')).toHaveValue('2');
  expect(problems).toEqual([]);
});
