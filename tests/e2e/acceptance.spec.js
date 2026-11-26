import { test, expect } from '@playwright/test';
import { ext, fx, openApp, loadFile, editor, runButton } from './helpers.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dot = (page, name) => page.locator(`[role=treeitem][data-name="${name}"] .dot-loaded, [role=treeitem][data-name="${name}"] .dot-conn`);
const treeitem = (page, name) => page.locator(`[role=treeitem][data-name="${name}"]`);
const header = (page, name) => page.locator('.dock-panel[data-panel=result] .grid-hcell', { hasText: name }).first();
const stepNames = (page) => page.locator('.step-row .step-name').evaluateAll((els) => els.map((e) => e.textContent));
const KEPT = ['Source', 'Promoted', 'Changed Type', 'Filtered Rows', 'Added Margin', 'Sorted Rows', 'Result'];

const MACRO = [
  'Public Sub RefreshSales()',
  '  With ThisWorkbook',
  '    .Connections("Query - RawInput").Refresh',
  '    .Connections("Query - FinalTable").Refresh',
  '    .Connections("Query - fGetNamedRange").Refresh',
  '    .Connections("Query - Ghost").Refresh',
  '  End With',
  'End Sub'
].join('\r\n');

test('T-WB-28: the acceptance story', async ({ page }) => {
  test.setTimeout(720000);
  await page.setViewportSize({ width: 1400, height: 900 });
  const problems = await openApp(page);
  const search = page.getByRole('searchbox', { name: 'Search queries' });

  await loadFile(page, fx('many-queries.xlsx'));
  await expect(page.locator('.nav-list [role=treeitem]').first()).toHaveAttribute('aria-setsize', '320');
  await expect(page.locator('.status-problems')).toHaveText('Problems 4');

  await search.fill('sales');
  await expect(page.locator('.nav-list [role=treeitem][data-name]')).toHaveCount(9);
  await page.getByRole('button', { name: 'Errors' }).click();
  await expect(page.locator('.nav-list [role=treeitem][data-name]')).toHaveCount(1);
  await page.locator('.nav-list [role=treeitem][data-name]').first().click();
  await expect(page.locator('.gutter .gutter-err')).toBeVisible();
  await editor(page).fill('let\r\n    Source = Sales_Raw,\r\n    Bad = Table.SelectRows(Source, each [Amount] > 0)\r\nin\r\n    Bad');
  await expect(page.locator('.status-problems')).toHaveText('Problems 3');
  await page.getByRole('button', { name: 'Errors' }).click();

  await page.keyboard.press('Control+Alt+Enter');
  await page.getByRole('dialog', { name: 'Some files are not bound yet' }).getByRole('button', { name: 'Run anyway' }).click();
  await page.getByRole('tab', { name: 'Queue' }).click();
  await expect(page.locator('.dock-panel[data-panel=queue] .queue-table tbody tr').first()).toBeVisible({ timeout: 8000 });
  await page.locator('dialog[open]').getByRole('button', { name: 'Skip' }).click({ timeout: 30000 });
  await expect(page.locator('.statusbar')).toContainText(/ran/, { timeout: 60000 });
  await expect(dot(page, 'Sales_Clean')).toHaveAttribute('data-status', 'ok');
  await page.getByRole('tab', { name: 'Result' }).click();

  await search.fill('Sales_Clean');
  await treeitem(page, 'Sales_Clean').click();
  await page.getByRole('button', { name: 'Evaluate steps' }).click();
  await expect(page.locator('.step-row')).toHaveCount(7);
  await expect(page.locator('.step-row .bead-ok').first()).toBeVisible();
  await page.locator('.editor-wrap textarea').focus();
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < 5; i++) await page.keyboard.press('F10');
  await expect(page.locator('.step-row.is-current')).toContainText('Sorted Rows');

  await header(page, 'Region').click();
  await page.getByRole('menuitem', { name: 'Filter\u2026' }).click();
  const dlg = page.getByRole('dialog', { name: 'Filter Region' });
  await dlg.getByRole('radio', { name: 'Condition' }).check();
  await dlg.locator('select').selectOption({ label: 'equals' });
  await dlg.getByLabel('Value', { exact: true }).fill('North');
  await dlg.getByRole('button', { name: 'Filter the view' }).click();
  await expect(page.locator('.chip.view')).toContainText('View only');
  await header(page, 'Region').click();
  await page.getByRole('menuitem', { name: 'Add as a step\u2026' }).click();
  const add = page.getByRole('dialog', { name: 'Add a step for Region' });
  await add.locator('select').first().selectOption({ label: 'Filter rows' });
  await add.locator('select').nth(1).selectOption({ label: 'equals' });
  await add.getByLabel('Value', { exact: true }).fill('North');
  await add.getByRole('button', { name: 'Insert step' }).click();
  await expect(page.locator('.step-row')).toHaveCount(8);
  const withNew = await stepNames(page);
  const newName = withNew.find((n) => !KEPT.includes(n));
  expect(newName).toBeTruthy();
  const idle = () => expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  await expect(page.locator('.steps-host .steps-live')).toContainText('Inserted', { timeout: 15000 });

  for (let guard = 0; guard < 6; guard++) {
    const names = await stepNames(page);
    const at = names.indexOf(newName);
    if (names[at + 1] === 'Changed Type') break;
    await page.locator('.step-row').nth(at).focus();
    await page.keyboard.press('Alt+Shift+ArrowUp');
    const apply = page.locator('.step-preview').getByRole('button', { name: 'Apply' });
    await expect(apply).toBeVisible({ timeout: 5000 });
    await apply.click();
    await expect.poll(async () => (await stepNames(page)).indexOf(newName)).toBeLessThan(at);
    await idle();
  }
  const moved = await stepNames(page);
  expect(moved[moved.indexOf(newName) + 1]).toBe('Changed Type');
  const margin = moved.indexOf('Added Margin');
  await page.locator('.step-row').nth(margin).focus();
  await page.keyboard.press('Alt+Shift+ArrowUp');
  const apply2 = page.locator('.step-preview').getByRole('button', { name: 'Apply' });
  await expect(apply2).toBeVisible({ timeout: 5000 });
  await apply2.click();
  await expect.poll(async () => (await stepNames(page)).indexOf('Added Margin')).toBeLessThan(margin);
  await idle();

  await search.fill('sales');
  await expect(dot(page, 'Sales_Clean')).toHaveAttribute('data-status', 'stale');
  await expect(dot(page, 'Sales_Summary')).toHaveAttribute('data-status', 'stale');
  await expect(dot(page, 'Sales_by_Region')).toHaveAttribute('data-status', 'stale');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('show the dependency graph');
  await page.locator('.palette-row').filter({ hasText: /^Show the dependency graph$/ }).click();
  await expect(page.locator('.graph-node[data-name="Sales_Summary"] .graph-bead')).toHaveClass(/bead-stale/);
  await expect(page.locator('.graph-node[data-name="Sales_by_Region"] .graph-bead')).toHaveClass(/bead-stale/);
  await page.keyboard.press('Control+Shift+Enter');
  await expect(page.locator('.statusbar')).toContainText(/ran/, { timeout: 60000 });
  await expect(dot(page, 'Sales_Summary')).toHaveAttribute('data-status', 'ok');
  await expect(dot(page, 'Sales_by_Region')).toHaveAttribute('data-status', 'ok');

  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Review \d+ changes/ }).click();
  const lines = await page.locator('dialog[open] .change-line').allTextContents();
  expect(lines.join('\n')).toMatch(/Step added:/);
  expect(lines.join('\n')).toMatch(/Steps reordered:/);
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  await page.keyboard.press('Control+s');
  const ack = page.locator('.popover input[type=checkbox]');
  if (await ack.count()) await ack.check();
  const target = join(mkdtempSync(join(tmpdir(), 'wb28-')), 'saved.xlsx');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.popover .btn-primary').press('Enter')]);
  await dl.saveAs(target);
  await page.setInputFiles('input[type=file]', target);
  await page.getByRole('button', { name: 'Discard and open' }).click();
  await page.waitForSelector('.workspace, .empty .message');
  await search.fill('Sales_Clean');
  await treeitem(page, 'Sales_Clean').click();
  const saved = await editor(page).inputValue();
  expect(saved).toContain(newName);
  expect(saved.indexOf(`"${newName}"`)).toBeLessThan(saved.indexOf('#"Changed Type"'));

  await loadFile(page, fx('mixed.xlsm'));
  await treeitem(page, 'Module1').click();
  await editor(page).fill(MACRO);
  const proc = page.locator('.outline-proc', { hasText: 'RefreshSales' });
  await expect(proc.locator('.outline-links').first()).toBeVisible();
  await proc.getByRole('button', { name: 'Run these queries' }).click();
  await expect(dot(page, 'RawInput')).toHaveAttribute('data-status', 'ok');
  await expect(dot(page, 'FinalTable')).toHaveAttribute('data-status', 'ok');
  await expect(page.locator('.statusbar')).toContainText(/2 ran/);
  await expect(proc.locator('.outline-links').first()).toContainText('Not in this workbook: Ghost');

  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  expect(problems).toEqual([]);
});
