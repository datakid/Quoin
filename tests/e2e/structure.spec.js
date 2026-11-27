import { test, expect } from '@playwright/test';
import { ext, openApp, loadFile, editor, openDownload } from './helpers.js';

const MODULE = 'Public Sub Alpha()\r\n  Exit Function\r\nEnd Sub\r\nPublic Sub Alpha()\r\nEnd Sub';

async function open(page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  const problems = await openApp(page);
  await loadFile(page, ext('pq_vba_complex.xlsm'));
  await page.locator('[role=treeitem][data-name="Sheet1"]').click();
  await editor(page).fill(MODULE);
  return problems;
}

test('T-WB-23: structure checks mark the gutter lines after the debounce', async ({ page }) => {
  await open(page);
  const marks = page.locator('.gutter .gutter-mark');
  await expect(marks).toHaveCount(2);
  await expect(marks.first()).toHaveText(/2/);
  await expect(marks.nth(1)).toHaveText(/4/);
});

test('T-WB-23: the Download tooltip lists the structure checks without blocking the save', async ({ page }) => {
  const problems = await open(page);
  await expect(page.getByRole('button', { name: /^Changes \d+/ })).toHaveAttribute('aria-disabled', 'false');
  await openDownload(page);
  const pop = page.locator('.popover');
  await expect(pop).toBeVisible();
  await expect(pop.locator('.structure-note')).toContainText('2 structure checks');
  await expect(pop.locator('.structure-note')).toContainText('Exit Function inside a Sub');
  await expect(pop.locator('.structure-note')).toContainText('Alpha is already defined on line 1');
  await expect(pop.locator('.btn-primary')).toBeEnabled();
  await pop.getByRole('button', { name: 'Review changes' }).click();
  const dlg = page.locator('dialog');
  await expect(dlg.locator('.change-problems')).toContainText('Exit Function inside a Sub');
  await expect(dlg.locator('.change-problems')).toContainText('Alpha is already defined on line 1');
  expect(problems).toEqual([]);
});
