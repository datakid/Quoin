import { test, expect } from '@playwright/test';
import { ext, openApp, loadFile, changesButton, openDownload } from './helpers.js';

async function open(page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await loadFile(page, ext('pq_simple.xlsx'));
  await page.locator('[role=treeitem][data-type=query]').first().click();
}

test('T-WB-26: after reorder, insert and bypass the summary lists exactly those three', async ({ page }) => {
  await open(page);
  await page.locator('.step-row').nth(2).focus();
  await page.keyboard.press('Alt+Shift+ArrowUp');
  await page.locator('dialog[open]').getByRole('button', { name: 'Move and rewire' }).click();
  await page.locator('.step-row').nth(0).focus();
  await page.keyboard.press('Control+d');
  await expect(page.locator('.step-row')).toHaveCount(4);
  await page.locator('.step-row').nth(3).focus();
  await page.keyboard.press('b');
  await openDownload(page);
  await page.getByRole('button', { name: 'Review changes' }).click();
  const dlg = page.locator('dialog[open]');
  const lines = await dlg.locator('.change-line').allTextContents();
  expect(lines.length).toBe(3);
  expect(lines[0]).toMatch(/^Steps reordered: /);
  expect(lines[1]).toBe('Step added: Source (2)');
  expect(lines[2]).toMatch(/^Step bypassed: /);
});

test('T-WB-26: a changed macro lists its procedures and an error in a changed query is shown at the top', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await loadFile(page, ext('pq_vba_complex.xlsm'));
  await page.locator('[role=treeitem][data-name="RawInput"]').click();
  await page.locator('.editor-wrap textarea').fill('let\n  a = Missing\nin a');
  await expect.poll(() => page.locator('.status-problems').textContent()).toMatch(/Problems [1-9]/);
  await page.locator('[role=treeitem][data-name="Sheet1"]').click();
  const m = await page.locator('.editor-wrap textarea').inputValue();
  await page.locator('.editor-wrap textarea').fill(m.replace('On Error GoTo ExitSub', 'On Error GoTo ExitSub\n    Debug.Print 1'));
  await openDownload(page);
  await page.getByRole('button', { name: 'Review changes' }).click();
  const dlg = page.locator('dialog[open]');
  await expect(dlg.locator('.change-problems')).toContainText('RawInput');
  await expect(dlg.locator('.change-problems')).toContainText('Missing');
  await expect(dlg.locator('.change-line', { hasText: 'Procedures changed: Worksheet_Change' })).toBeVisible();
});
