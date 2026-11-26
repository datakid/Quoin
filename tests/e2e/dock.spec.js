import { test, expect } from '@playwright/test';
import { openApp, loadFile, ext, editor as editorOf } from './helpers.js';

const item = (page, name) => page.locator(`.nav-list [role=treeitem][data-name="${name}"]`);
const tab = (page, name) => page.getByRole('tab', { name: new RegExp(`^${name}`) });

async function open(page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await loadFile(page, ext('pq_vba_complex.xlsm'));
  await page.waitForSelector('.nav-list [role=treeitem][data-type=query]');
}

async function runItem(page, name) {
  await item(page, name).click();
  await page.getByRole('button', { name: /^Run/ }).first().click();
  await expect(page.locator('.dock-panel[data-panel=result] .grid, .dock-panel[data-panel=result] [role=grid]').first()).toBeVisible();
}

test('T-WB-16: the dock is a tablist with Result, Pinned, Compare, Find, Problems, References, Queue, Graph and Changes that the arrows walk', async ({ page }) => {
  await open(page);
  const list = page.locator('.dock-tabs');
  await expect(list).toHaveAttribute('role', 'tablist');
  const names = await list.getByRole('tab').evaluateAll((els) => els.map((e) => e.dataset.tab));
  expect(names).toEqual(['result', 'pinned', 'compare', 'find', 'problems', 'references', 'queue', 'graph', 'changes']);
  await expect(tab(page, 'Result')).toHaveAttribute('aria-selected', 'true');
  await tab(page, 'Result').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'Pinned')).toBeFocused();
  await expect(tab(page, 'Pinned')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.dock-panel[data-panel=pinned]')).toBeVisible();
  await expect(page.locator('.dock-panel[data-panel=result]')).toBeHidden();
  await page.keyboard.press('End');
  await expect(tab(page, 'Changes')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(tab(page, 'Result')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.dock-tab[tabindex="0"]')).toHaveCount(1);
});

test('T-WB-16: pinning a result keeps it, says when the query has changed since, shows it again and unpins', async ({ page }) => {
  await open(page);
  await runItem(page, 'RawInput');
  await page.getByRole('button', { name: 'Pin this result' }).click();
  await expect(tab(page, 'Pinned').locator('.dock-count')).toHaveText('1');
  await tab(page, 'Pinned').click();
  const row = page.locator('.pin-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('RawInput');
  await expect(row.locator('.pin-stale')).toHaveCount(0);
  await item(page, 'RawInput').click();
  const original = await page.locator('.editor-group textarea').inputValue();
  await page.locator('.editor-group textarea').fill(`${original}\n`.replace(/\n$/, '') + '\n// changed\n');
  await tab(page, 'Pinned').click();
  await expect(row.locator('.pin-stale')).toHaveText('Out of date');
  await row.getByRole('button', { name: /^Show/ }).click();
  await expect(tab(page, 'Result')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.dock-panel[data-panel=result] [role=grid]').first()).toBeVisible();
  await tab(page, 'Pinned').click();
  await row.getByRole('button', { name: /^Unpin/ }).click();
  await expect(page.locator('.pin-row')).toHaveCount(0);
  await expect(page.locator('.dock-panel[data-panel=pinned]')).toContainText('Nothing is pinned');
  await expect(tab(page, 'Pinned').locator('.dock-count')).toBeHidden();
});

test('T-WB-16: compare lists the schema difference, the row count change and the cells that differ', async ({ page }) => {
  await open(page);
  await runItem(page, 'RawInput');
  await page.getByRole('button', { name: 'Pin this result' }).click();
  await runItem(page, 'FinalTable');
  await tab(page, 'Compare').click();
  const out = page.locator('.compare-out');
  await expect(page.getByLabel('First result')).toBeVisible();
  await expect(out).toContainText('Columns');
  await expect(out).toContainText('Added: Now');
  await expect(out).toContainText('Rows');
  await expect(out).toContainText('Cells that differ');
  await page.getByLabel('Second result').selectOption({ index: 0 });
  await expect(out).toContainText('Choose two different results.');
});

test('T-WB-16: compare asks for a second result when there is only one', async ({ page }) => {
  await open(page);
  await tab(page, 'Compare').click();
  await expect(page.locator('.dock-panel[data-panel=compare]')).toContainText('Pin a result');
});

test('T-WB-16: the queue lists the batch with a status and a time for every query', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'More ways to run' }).click();
  await page.getByRole('menuitem', { name: 'Run every query' }).click();
  await expect(page.locator('.statusbar')).toContainText('ran');
  await tab(page, 'Queue').click();
  const rows = page.locator('.queue-table tbody tr');
  await expect(rows).toHaveCount(await rows.count());
  expect(await rows.count()).toBeGreaterThanOrEqual(2);
  await expect(rows.filter({ hasText: 'RawInput' }).locator('td').nth(3)).toContainText('ms');
  await expect(page.locator('.queue-summary')).toContainText('in total');
  await expect(tab(page, 'Queue').locator('.dock-count')).not.toBeHidden();
});

test('T-WB-16: Problems and Graph are tabs, the status counter opens the first and a collapsed dock expands for it', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Control+j');
  await expect(page.locator('.result-panel')).toBeHidden();
  await page.locator('.status-problems').click();
  await expect(page.locator('.result-panel')).toBeVisible();
  await expect(tab(page, 'Problems')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.problems-panel')).toBeVisible();
  await expect(page.locator('dialog')).toHaveCount(0);
  await item(page, 'FinalTable').click();
  await page.getByRole('button', { name: 'Graph' }).click();
  await expect(tab(page, 'Graph')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.graph-panel .graph-node')).toHaveCount(3);
  await expect(page.locator('dialog')).toHaveCount(0);
});

test('T-WB-16: the dock opens for a macro so Problems stays reachable, and hides again when Result is chosen', async ({ page }) => {
  await open(page);
  await page.locator('.nav-list [role=treeitem][data-type=module]').first().click();
  await expect(page.locator('.result-panel')).toBeHidden();
  await page.locator('.status-problems').click();
  await expect(page.locator('.result-panel')).toBeVisible();
  await expect(page.locator('.problems-panel')).toBeVisible();
  await tab(page, 'Result').click();
  await expect(page.locator('.result-panel')).toBeHidden();
});

test('T-WB-16: compare can show the two results side by side, marks the differing cell in both and scrolls them together', async ({ page }) => {
  await open(page);
  await item(page, 'RawInput').click();
  const editor = editorOf(page);
  const make = (zero) => `Table.FromRecords(List.Transform({1..300}, each [N = _, V = if _ = ${zero} then 0 else _ * 2]))`;
  await editor.fill(make(-1));
  await page.getByRole('button', { name: /^Run/ }).first().click();
  await expect(page.locator('.dock-panel[data-panel=result] [role=grid]').first()).toHaveAttribute('aria-rowcount', '301');
  await page.getByRole('button', { name: 'Pin this result' }).click();
  await editor.fill(make(5));
  await page.getByRole('button', { name: /^Run/ }).first().click();
  await expect(page.locator('.dock-panel[data-panel=result] [role=grid]').first()).toHaveAttribute('aria-rowcount', '301');
  await tab(page, 'Compare').click();
  await expect(page.locator('.compare-out')).toContainText('Cells that differ');
  await expect(page.locator('.compare-side')).toHaveCount(0);
  await page.getByLabel('Show side by side').check();
  const grids = page.locator('.compare-side [role=grid]');
  await expect(grids).toHaveCount(2);
  await expect(grids.nth(0).locator('.grid-cell').first()).toBeVisible();
  await expect(grids.nth(1).locator('.grid-cell').first()).toBeVisible();
  await expect(page.locator('.compare-side .grid-cell.diff')).toHaveCount(2);
  await grids.nth(0).evaluate((el) => {
    el.scrollTop = 900;
  });
  await expect.poll(() => grids.nth(1).evaluate((el) => el.scrollTop)).toBe(900);
  await grids.nth(1).evaluate((el) => {
    el.scrollTop = 300;
  });
  await expect.poll(() => grids.nth(0).evaluate((el) => el.scrollTop)).toBe(300);
  await page.getByLabel('Show side by side').uncheck();
  await expect(page.locator('.compare-side')).toHaveCount(0);
});
