import { test, expect } from '@playwright/test';
import { ext, openApp, loadFile } from './helpers.js';

const BODY = [
  'Option Explicit',
  '',
  'Public Sub Alpha()',
  '  x = 1',
  'End Sub',
  '',
  'Private Function Beta(ByVal n As Long) As Long',
  '  Beta = n',
  'End Function',
  '',
  'Public Sub Gamma()',
  '  y = 2',
  'End Sub'
].join('\r\n');

async function open(page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  const problems = await openApp(page);
  await loadFile(page, ext('pq_vba_complex.xlsm'));
  await page.locator('[role=treeitem][data-type=module]').nth(1).click();
  return problems;
}

const area = (page) => page.locator('.editor-wrap textarea');
const rows = (page) => page.locator('.outline-body .outline-row[data-key]');

test('T-WB-22: the outline lists procedures with kind, signature, entry points and follows the caret in the title area', async ({ page }) => {
  const problems = await open(page);
  await area(page).fill(BODY);
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).nth(0)).toContainText('Sub');
  await expect(rows(page).nth(0)).toContainText('Alpha()');
  await expect(rows(page).nth(1)).toContainText('Beta(n)');
  await expect(rows(page).nth(1)).toContainText('Private');
  await expect(page.locator('.outline-label', { hasText: 'Procedures 3' })).toBeVisible();
  await rows(page).nth(2).click();
  const line = await page.evaluate(() => {
    const ta = document.querySelector('.editor-wrap textarea');
    return ta.value.slice(0, ta.selectionStart).split(/\r\n|\r|\n/).length;
  });
  expect(line).toBe(11);
  await expect(page.locator('.item-actions .item-meta').first()).toContainText('Gamma');
  expect(problems).toEqual([]);
});

test('T-WB-22: reverting one of two edited procedures leaves the other edited', async ({ page }) => {
  await open(page);
  const before = await area(page).inputValue();
  const body = before.replace(/\r\n|\n/g, '\r\n');
  const edited = body.includes('End Sub') ? body.replace('End Sub', '  Debug.Print 1\r\nEnd Sub') : `${body}\r\nSub Added1()\r\nEnd Sub`;
  await area(page).fill(`${edited}\r\n\r\nSub Added2()\r\nEnd Sub`);
  await expect(page.locator('.outline-body .step-tag', { hasText: /Edited|Added/ }).first()).toBeVisible();
  const addedRow = page.locator('.outline-row', { hasText: 'Added2' });
  await expect(addedRow).toContainText('Added');
  await addedRow.locator('xpath=following-sibling::button').click();
  await page.getByRole('menuitem', { name: 'Revert this procedure' }).click();
  await expect(page.locator('.outline-row', { hasText: 'Added2' })).toHaveCount(0);
  expect(await area(page).inputValue()).not.toContain('Added2');
  await expect(page.locator('.outline-body .step-tag', { hasText: /Edited|Added/ }).first()).toBeVisible();
});

test('T-WB-22: a removed procedure is listed and can be put back', async ({ page }) => {
  await open(page);
  const text = await area(page).inputValue();
  expect(text.length).toBeGreaterThan(0);
  const name = await page.locator('.outline-body .outline-row[data-key]').first().locator('.step-name').textContent();
  const proc = name.split('(')[0];
  await area(page).fill('Option Explicit\r\n');
  await expect(page.locator('.outline-label', { hasText: 'Removed procedures' })).toBeVisible();
  await expect(page.locator('.outline-row.is-bypassed', { hasText: proc })).toBeVisible();
  await page.getByRole('button', { name: 'Put back' }).first().click();
  await expect(page.locator('.outline-row[data-key]', { hasText: proc })).toHaveCount(1);
});
