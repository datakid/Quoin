import { test, expect } from '@playwright/test';
import { ext, openApp, loadFile } from './helpers.js';

async function open(page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  const problems = await openApp(page);
  await loadFile(page, ext('pq_vba_complex.xlsm'));
  return problems;
}

test('T-WB-17: the inspector lists what a query depends on and what uses it, with an impact line', async ({ page }) => {
  const problems = await open(page);
  await page.locator('[role=treeitem][data-name="FinalTable"]').click();
  const deps = page.locator('.deps-panel');
  await expect(deps.locator('.deps-col').nth(0)).toContainText('RawInput');
  await expect(deps.locator('.deps-col').nth(1)).toContainText('None');
  await expect(deps.locator('.deps-impact')).toHaveText('Nothing else uses this query.');
  await page.locator('[role=treeitem][data-name="RawInput"]').click();
  await expect(deps.locator('.deps-col').nth(1)).toContainText('FinalTable');
  await expect(deps.locator('.deps-impact')).toContainText('Editing this affects 1 query');
  await deps.getByRole('button', { name: 'FinalTable' }).click();
  await expect(page.locator('.item-title')).toContainText('FinalTable');
  expect(problems).toEqual([]);
});

test('T-WB-17: the graph opens on the current query, the keyboard walks along edges and Enter opens the node', async ({ page }) => {
  await open(page);
  await page.locator('[role=treeitem][data-name="FinalTable"]').click();
  await page.getByRole('button', { name: 'Graph' }).click();
  const dlg = page.locator('.graph-panel');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('.graph-node')).toHaveCount(3);
  await expect(dlg.locator('.graph-node.is-selected')).toHaveAttribute('data-name', 'FinalTable');
  await expect(dlg.locator('.graph-svg')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(dlg.locator('.graph-node.is-selected')).toHaveAttribute('data-name', 'RawInput');
  await expect(dlg.locator('.graph-selected')).toContainText('Used by FinalTable');
  await page.keyboard.press('ArrowRight');
  await expect(dlg.locator('.graph-node.is-selected')).toHaveAttribute('data-name', 'FinalTable');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await expect(page.locator('.item-title')).toContainText('RawInput');
});

test('T-WB-17: the graph is a labelled application region, node colours do not depend on colour alone and the edge highlights follow the selection', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('>dependency graph');
  await page.keyboard.press('Enter');
  const dlg = page.locator('.graph-panel');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('.graph-svg')).toHaveAttribute('role', 'application');
  await expect(dlg.locator('.graph-svg')).toHaveAttribute('aria-label', /Arrow left goes to a query/);
  await page.locator('.graph-node[data-name="RawInput"]').click();
  await expect(dlg.locator('.graph-edge.is-on')).toHaveCount(2);
  await expect(dlg.locator('.graph-node.is-down')).toHaveCount(1);
  await expect(dlg.locator('.graph-node.is-up')).toHaveCount(1);
  await dlg.getByRole('button', { name: 'Zoom in' }).click();
  const before = await dlg.locator('.graph-svg').getAttribute('viewBox');
  await dlg.locator('.graph-svg').focus();
  await page.keyboard.press('Shift+ArrowRight');
  expect(await dlg.locator('.graph-svg').getAttribute('viewBox')).not.toBe(before);
  await dlg.getByRole('button', { name: 'Fit' }).click();
  await dlg.getByRole('button', { name: 'Run with downstream' }).click();
  await expect(page.locator('.statusbar')).toContainText('ran');
});
