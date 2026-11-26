import { test, expect } from '@playwright/test';
import { ext, openApp, loadFile, item, editor, changesButton, openDownload } from './helpers.js';

test('T-E-01: the Download button follows one dirty model, including a hand revert with a trailing newline', async ({ page }) => {
  await openApp(page);
  await loadFile(page, ext('pq_vba_complex.xlsm'));
  const dl = page.getByRole('button', { name: /^Changes \d+$/ });
  await expect(dl).toHaveAttribute('aria-disabled', 'true');
  await expect(dl).toHaveAttribute('title', 'No changes yet.');
  await expect(dl).toHaveAccessibleName('Changes 0');

  await item(page, 'RawInput').click();
  const original = await editor(page).inputValue();
  await editor(page).fill(`${original}\n// one`);
  await expect(dl).not.toHaveAttribute('aria-disabled', 'true');
  await expect(dl).toHaveAccessibleName('Changes 1');

  await item(page, 'Sheet1').click();
  const module = await editor(page).inputValue();
  await editor(page).fill(`${module}\n' two`);
  await expect(dl).toHaveAccessibleName('Changes 2');

  await editor(page).fill(module);
  await item(page, 'RawInput').click();
  await editor(page).fill(`${original}\n\n`);
  await expect(dl).toHaveAttribute('aria-disabled', 'true');
  await expect(dl).toHaveAccessibleName('Changes 0');
  await expect(page.locator('[data-name=RawInput] .dot-edited')).toHaveCount(0);
});

test('T-E-01: a clean Changes button opens no menu and Ctrl+S does not either', async ({ page }) => {
  await openApp(page);
  await loadFile(page, ext('pq_vba_complex.xlsm'));
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const menu = page.locator('.menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Review changes' })).toBeDisabled();
  await expect(menu.getByRole('menuitem', { name: 'Save a copy…' })).toBeEnabled();
  await expect(menu.getByRole('menuitem', { name: 'Download' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+s');
  await expect(page.locator('.popover')).toHaveCount(0);
});
