import { test, expect } from '@playwright/test';
import { ext, openApp, loadFile, item, editor } from './helpers.js';

const tab = (page) => page.getByRole('tab', { name: /^Changes/ });
const panel = (page) => page.locator('.dock-panel[data-panel=changes]');

async function setup(page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await loadFile(page, ext('pq_vba_complex.xlsm'));
  await item(page, 'RawInput').click();
}

test('T-WB-16: the Changes tab says nothing has changed, then lists an edited query with its diff', async ({ page }) => {
  await setup(page);
  await tab(page).click();
  await expect(panel(page)).toContainText('Nothing has changed since the workbook was opened.');
  const original = await editor(page).inputValue();
  await editor(page).fill(original.replace(/\s+$/, '') + '\n// edited');
  await expect(tab(page).locator('.dock-count')).toHaveText('1');
  await expect(panel(page).locator('.change-item')).toHaveCount(1);
  await expect(panel(page).locator('.change-name')).toHaveText('RawInput');
  await panel(page).locator('summary').click();
  await expect(panel(page).locator('.diff-scroll')).toBeVisible();
});

test('T-WB-16: Revert all in the Changes tab asks first, and reverting restores the text and empties the tab', async ({ page }) => {
  await setup(page);
  const original = await editor(page).inputValue();
  await editor(page).fill(original.replace(/\s+$/, '') + '\n// edited');
  await tab(page).click();
  await expect(panel(page).locator('.change-item')).toHaveCount(1);
  await panel(page).getByRole('button', { name: 'Revert all' }).click();
  const dlg = page.getByRole('dialog', { name: 'Revert all changes' });
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await expect(panel(page).locator('.change-item')).toHaveCount(1);
  await panel(page).getByRole('button', { name: 'Revert all' }).click();
  await page.getByRole('dialog', { name: 'Revert all changes' }).getByRole('button', { name: 'Revert all' }).click();
  await expect(panel(page)).toContainText('Nothing has changed since the workbook was opened.');
  await expect(tab(page).locator('.dock-count')).toBeHidden();
  expect(await editor(page).inputValue()).toBe(original);
});

test('T-WB-16: the Changes dialog from Download still opens and lists the same edit', async ({ page }) => {
  await setup(page);
  const original = await editor(page).inputValue();
  await editor(page).fill(original.replace(/\s+$/, '') + '\n// edited');
  await page.getByRole('button', { name: /^Download/ }).click();
  await page.getByRole('button', { name: 'Review changes' }).click();
  const dlg = page.getByRole('dialog', { name: 'Changes' });
  await expect(dlg.locator('.change-item')).toHaveCount(1);
  await expect(dlg.locator('.change-name')).toHaveText('RawInput');
});
