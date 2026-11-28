import { test, expect } from '@playwright/test';
import { ext, openApp, loadFile } from './helpers.js';

const more = (page) => page.getByRole('button', { name: 'More actions' });

test('T-V-07: before a workbook is open the overflow menu offers what needs no workbook', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await expect(more(page)).toBeVisible();
  await more(page).click();
  const names = await page.getByRole('menuitem').allTextContents();
  expect(names).toHaveLength(6);
  expect(names[0]).toBe('Open file');
  expect(names[1]).toMatch(/^Theme/);
  expect(names[2]).toMatch(/^Density/);
  expect(names.slice(3)).toEqual(['Settings', 'Shortcut sheet', 'About']);
});

test('T-V-07: Settings opens from the empty state and the theme choice there applies at once', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await more(page).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close' }).click();
  const before = await page.evaluate(() => document.documentElement.dataset.theme || '');
  await more(page).click();
  await page.getByRole('menuitem', { name: /^Theme/ }).click();
  const after = await page.evaluate(() => document.documentElement.dataset.theme || '');
  expect(after).not.toBe(before);
});

test('T-V-07: Open file from the empty state opens the chooser, and shortcuts and About open their dialogs', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await more(page).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: 'Open file' }).click()]);
  await chooser.setFiles(ext('pq_simple.xlsx'));
  await expect(page.locator('.nav-list [role=treeitem]').first()).toBeVisible();
  await more(page).click();
  await page.getByRole('menuitem', { name: 'Shortcut sheet' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await more(page).click();
  await page.getByRole('menuitem', { name: 'About' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('T-V-07: once a workbook is open the full menu replaces the short one', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await loadFile(page, ext('pq_simple.xlsx'));
  await more(page).click();
  const names = await page.getByRole('menuitem').allTextContents();
  expect(names.length).toBeGreaterThan(8);
  expect(names).toContain('Write');
  expect(names).toContain('Sources\u2026');
});
