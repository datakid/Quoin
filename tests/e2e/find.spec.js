import { test, expect } from '@playwright/test';
import { ext, openApp, loadFile } from './helpers.js';

async function open(page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  const problems = await openApp(page);
  await loadFile(page, ext('pq_vba_complex.xlsm'));
  return problems;
}

const dlg = (page) => page.locator('#dock-panel-find');
const area = (page) => page.locator('.editor-wrap textarea');

test('T-WB-21: find lists matches grouped by item with line previews and opens one at its position', async ({ page }) => {
  const problems = await open(page);
  await page.keyboard.press('Control+Shift+f');
  await expect(dlg(page)).toBeVisible();
  await page.locator('.find-input').first().fill('RawInput');
  await expect(dlg(page).locator('.find-status')).toContainText('matches');
  await expect(dlg(page).locator('.find-item', { hasText: 'FinalTable' })).toBeVisible();
  const row = dlg(page).locator('.find-row', { hasText: 'Raw = RawInput' });
  await expect(row).toContainText('2:');
  await row.click();
  await expect(dlg(page)).toBeVisible();
  await expect(page.locator('.item-title')).toContainText('FinalTable');
  const line = await page.evaluate(() => {
    const ta = document.querySelector('.editor-wrap textarea');
    return ta.value.slice(0, ta.selectionStart).split(/\r\n|\r|\n/).length;
  });
  expect(line).toBe(2);
  expect(problems).toEqual([]);
});

test('T-WB-21: code only skips the hit inside a comment', async ({ page }) => {
  await open(page);
  await page.locator('[role=treeitem][data-name="FinalTable"]').click();
  await area(page).fill('let\n  // Raw is a comment\n  a = "Raw text",\n  b = RawInput\nin b');
  await page.keyboard.press('Control+Shift+f');
  await page.locator('.find-input').first().fill('Raw');
  await expect(dlg(page).locator('.find-group', { hasText: 'FinalTable' }).locator('.count-pill')).toHaveText('3');
  await dlg(page).getByLabel('Code only').check();
  await expect(dlg(page).locator('.find-group', { hasText: 'FinalTable' }).locator('.count-pill')).toHaveText('1');
});

test('T-WB-21: replace in three of five matches changes exactly those three', async ({ page }) => {
  await open(page);
  await page.locator('[role=treeitem][data-name="FinalTable"]').click();
  await area(page).fill('let\n  a = Foo,\n  b = Foo,\n  c = Foo,\n  d = Foo,\n  e = Foo\nin e');
  await page.keyboard.press('Control+Alt+f');
  await expect(dlg(page)).toBeVisible();
  await page.locator('.find-input').nth(0).fill('Foo');
  await page.locator('.find-input').nth(1).fill('Bar');
  const group = dlg(page).locator('.find-group', { hasText: 'FinalTable' });
  await expect(group).toBeVisible();
  const boxes = dlg(page).locator('.find-match input[type=checkbox]');
  await expect(boxes).toHaveCount(5);
  await boxes.nth(1).uncheck();
  await boxes.nth(3).uncheck();
  await expect(dlg(page).getByRole('button', { name: 'Replace 3 selected' })).toBeVisible();
  await expect(dlg(page).locator('.find-diff').first()).toContainText('Bar');
  await dlg(page).getByRole('button', { name: 'Replace 3 selected' }).click();
  await expect(dlg(page)).toBeVisible();
  const text = await area(page).inputValue();
  expect(text).toBe('let\n  a = Bar,\n  b = Foo,\n  c = Bar,\n  d = Foo,\n  e = Bar\nin e');
  await expect(page.locator('.statusbar')).toContainText('Replaced 3 matches in 1 item');
  await page.keyboard.press('Control+z');
  expect(await area(page).inputValue()).toBe('let\n  a = Foo,\n  b = Foo,\n  c = Foo,\n  d = Foo,\n  e = Foo\nin e');
});

test('T-WB-21: an invalid regular expression shows its error under the field and nothing is listed', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Control+Shift+f');
  await dlg(page).getByLabel('Regular expression').check();
  await page.locator('.find-input').first().fill('(');
  await expect(dlg(page).locator('.find-error')).not.toBeEmpty();
  await expect(dlg(page).locator('.find-row')).toHaveCount(0);
});

test('T-WB-21: replacing works across queries and macros and the palette offers both commands', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('>find and replace');
  await expect(page.locator('.palette-row').first()).toContainText('Find and replace');
  await page.keyboard.press('Enter');
  await expect(dlg(page)).toBeVisible();
  await page.locator('.find-input').nth(0).fill('InputText');
  await expect(dlg(page).locator('.find-item', { hasText: 'Sheet1' })).toBeVisible();
  await dlg(page).locator('select').selectOption('modules');
  await expect(dlg(page).locator('.find-item', { hasText: 'RawInput' })).toHaveCount(0);
  await expect(dlg(page).locator('.find-item', { hasText: 'Sheet1' })).toBeVisible();
});

test('T-WB-21: the selection scope limits find to the navigator selection', async ({ page }) => {
  await open(page);
  await page.locator('[role=treeitem][data-name="FinalTable"]').click();
  await page.locator('[role=treeitem][data-name="RawInput"]').click({ modifiers: ['Control'] });
  await page.keyboard.press('Control+Shift+f');
  await dlg(page).locator('select').selectOption('selection');
  await page.locator('.find-input').first().fill('RawInput');
  await expect(dlg(page).locator('.find-item')).toHaveCount(2);
  await expect(dlg(page).locator('.find-item', { hasText: 'RawInput' })).toBeVisible();
  await expect(dlg(page).locator('.find-item', { hasText: 'FinalTable' })).toBeVisible();
  await expect(dlg(page).locator('.find-item', { hasText: 'Sheet1' })).toHaveCount(0);
});
