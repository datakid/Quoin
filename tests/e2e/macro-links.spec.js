import { test, expect } from '@playwright/test';
import { ext, openApp, loadFile } from './helpers.js';

const MACRO = [
  'Option Explicit',
  'Public Sub RefreshSales()',
  '  With ThisWorkbook',
  '    .Connections("Query - FinalTable").Refresh',
  '    .Connections("Query - RawInput").Refresh',
  '    .Connections("Query - Ghost").Refresh',
  '    .Connections("Query - " & name).Refresh',
  '  End With',
  'End Sub',
  'Public Sub Other()',
  '  x = 1',
  'End Sub'
].join('\r\n');

const dot = (page, name) => page.locator(`[role=treeitem][data-name="${name}"] .dot-loaded, [role=treeitem][data-name="${name}"] .dot-conn`);

async function open(page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  const problems = await openApp(page);
  await loadFile(page, ext('pq_vba_complex.xlsm'));
  await page.locator('[role=treeitem][data-name="Sheet1"]').click();
  await page.locator('.editor-wrap textarea').fill(MACRO);
  return problems;
}

test('T-WB-25: a procedure with links lists the queries it refreshes, what it cannot resolve, and nothing for the others', async ({ page }) => {
  const problems = await open(page);
  const proc = page.locator('.outline-proc', { hasText: 'RefreshSales' });
  await expect(proc.locator('.outline-links')).toBeVisible();
  await expect(proc.locator('.outline-link').nth(0)).toHaveText('FinalTable');
  await expect(proc.locator('.outline-link').nth(1)).toHaveText('RawInput');
  await expect(proc.locator('.outline-links')).toContainText('Not in this workbook: Ghost');
  await expect(proc.locator('.outline-links')).toContainText('1 call cannot be resolved');
  await expect(page.locator('.outline-proc', { hasText: 'Other' }).locator('.outline-links')).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('T-WB-25: Run these queries runs exactly the resolved queries and says that the rest of the macro does not run', async ({ page }) => {
  await open(page);
  await expect(dot(page, 'FinalTable')).toHaveAttribute('data-status', 'never');
  const proc = page.locator('.outline-proc', { hasText: 'RefreshSales' });
  await expect(proc.locator('.outline-links')).toBeVisible();
  await proc.getByRole('button', { name: 'Run these queries' }).click();
  await expect(dot(page, 'RawInput')).toHaveAttribute('data-status', 'ok');
  await expect(dot(page, 'FinalTable')).toHaveAttribute('data-status', 'ok');
  await expect(page.locator('.statusbar')).toContainText('Queries refreshed by RefreshSales');
  await expect(dot(page, 'fGetNamedRange')).not.toHaveAttribute('data-status', 'ok');
});

test('T-WB-25: a query shows which macro procedures refresh it', async ({ page }) => {
  await open(page);
  await page.locator('[role=treeitem][data-name="RawInput"]').click();
  await expect(page.locator('.refreshed-by')).toHaveText('Refreshed by: Sheet1.RefreshSales');
  await page.locator('[role=treeitem][data-name="fGetNamedRange"]').click();
  await expect(page.locator('.refreshed-by')).toBeHidden();
});
