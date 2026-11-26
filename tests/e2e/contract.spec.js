import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { devices } from '@playwright/test';
import { ext, fx, openApp, loadFile } from './helpers.js';

const CONTROLS = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/expected/controls.json', import.meta.url)), 'utf8'));
const pref = (name) => new RegExp(`^${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}`);

test('T-V-07: the no-loss contract - every listed control exists on its surface', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const problems = await openApp(page);
  await loadFile(page, ext('pq_vba_complex.xlsm'));

  for (const name of CONTROLS.topbar) await expect(page.getByRole('button', { name: pref(name) }).first()).toBeVisible();
  for (const name of CONTROLS.dockTabs) await expect(page.getByRole('tab', { name: pref(name) }).first()).toBeVisible();

  await expect(page.getByRole('searchbox', { name: pref(CONTROLS.navigatorSearch) })).toBeVisible();
  for (const name of CONTROLS.navigatorSelects) await expect(page.getByRole('combobox', { name: pref(name) })).toBeVisible();
  for (const name of CONTROLS.primaryChips) await expect(page.getByRole('button', { name: pref(name) }).first()).toBeVisible();

  await page.getByRole('button', { name: 'More filters' }).click();
  for (const name of CONTROLS.moreChips) await expect(page.getByRole('checkbox', { name: pref(name) }).first()).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'More actions' }).click();
  for (const name of CONTROLS.moreMenu) await expect(page.getByRole('menuitem', { name: pref(name) }).first()).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Download', exact: true }).click();
  for (const name of CONTROLS.changesMenu) await expect(page.getByRole('menuitem', { name: pref(name) }).first()).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'More ways to run' }).click();
  for (const name of CONTROLS.runMenu) await expect(page.getByRole('menuitem', { name: pref(name) }).first()).toBeVisible();
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+k');
  for (const name of CONTROLS.palette) {
    await page.locator('.palette-input').fill('');
    await page.keyboard.type(name);
    await expect(page.locator('.palette-row').filter({ hasText: pref(name) }).first()).toBeVisible();
  }
  await page.keyboard.press('Escape');
  expect(problems).toEqual([]);
});

test('T-V-03: hover-revealed step actions are equally visible on focus-within and under touch', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  await openApp(page);
  await loadFile(page, fx('csv-query.xlsx'));
  await page.locator('[role=treeitem][data-name="StudentResults"]').click();
  const item = page.locator('.steps-list .step-item').first();
  await expect(item).toBeVisible();
  const more = item.locator('.step-more');
  await expect(more).toHaveCSS('opacity', '0');
  await item.hover();
  await expect(more).toHaveCSS('opacity', '1');
  await item.getByRole('button').first().focus();
  await expect(more).toHaveCSS('opacity', '1');
  await page.locator('.editor-wrap textarea').click();
  await expect(more).toHaveCSS('opacity', '0');
  await page.close();

  const touch = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
  await openApp(touch);
  await loadFile(touch, fx('csv-query.xlsx'));
  await touch.getByRole('button', { name: 'Items' }).tap();
  await touch.locator('[role=treeitem][data-name="StudentResults"]').tap();
  await touch.getByRole('button', { name: 'Steps' }).tap();
  const touchItem = touch.locator('.steps-list .step-item').first();
  await expect(touchItem).toBeVisible();
  await expect(touchItem.locator('.step-more')).toHaveCSS('opacity', '1');
  await expect(touchItem.locator('.step-grip')).toHaveCSS('opacity', '1');
});
