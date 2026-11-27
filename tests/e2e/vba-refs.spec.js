import { test, expect } from '@playwright/test';
import { ext, openApp, loadFile, editor } from './helpers.js';

const MODULE = [
  'Public Sub RefreshAll()',
  '  Call LoadData',
  'End Sub',
  'Public Sub LoadData()',
  '  CleanUp 1',
  'End Sub',
  'Private Sub CleanUp(ByVal n As Long)',
  '  Dim RefreshAll As Long',
  '  RefreshAll = n',
  'End Sub'
].join('\r\n');

async function open(page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  const problems = await openApp(page);
  await loadFile(page, ext('pq_vba_complex.xlsm'));
  await page.locator('[role=treeitem][data-name="Sheet1"]').click();
  await editor(page).fill(MODULE);
  return problems;
}

const caretLine = (page) => page.evaluate(() => {
  const ta = document.querySelector('.editor-wrap textarea');
  return ta.value.slice(0, ta.selectionStart).split(/\r\n|\r|\n/).length;
});

const caretAfter = (page, needle) => page.evaluate((needle) => {
  const ta = document.querySelector('.editor-wrap textarea');
  const at = ta.value.indexOf(needle) + needle.length;
  ta.focus();
  ta.setSelectionRange(at, at);
}, needle);

const rightClick = (page) => page.evaluate(() => {
  const ta = document.querySelector('.editor-wrap textarea');
  ta.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
});

const proc = (key) => `.outline-proc:has(button[data-key="sub:${key}"])`;

test('T-WB-24: the outline lists Calls and Called by, with the honest no-callers note', async ({ page }) => {
  const problems = await open(page);
  await expect(page.locator(proc('refreshall')).locator('.outline-calls button')).toHaveText(['Sheet1.LoadData']);
  await expect(page.locator(proc('loaddata')).locator('.outline-calls button')).toHaveText(['Sheet1.CleanUp', 'Sheet1.RefreshAll']);
  await expect(page.locator(proc('cleanup')).locator('.outline-calls button')).toHaveText(['Sheet1.LoadData']);
  await expect(page.locator(proc('refreshall'))).toContainText('No callers found');
  await expect(page.locator(proc('refreshall'))).toContainText('It may be run from a button, a shape, another workbook or the Macros dialog.');
  await expect(page.locator(proc('cleanup'))).not.toContainText('No callers found');
  await page.locator(proc('refreshall')).locator('.outline-calls button').click();
  await expect.poll(() => caretLine(page)).toBe(4);
  expect(problems).toEqual([]);
});

test('T-WB-24: F12 goes to the definition and Shift+F12 lists the callers', async ({ page }) => {
  await open(page);
  await caretAfter(page, 'Call LoadData');
  await page.keyboard.press('F12');
  await expect.poll(() => caretLine(page)).toBe(4);
  await caretAfter(page, '  CleanUp');
  await page.keyboard.press('Shift+F12');
  await expect(page.locator('[role=tab][data-tab="references"]')).toHaveAttribute('aria-selected', 'true');
  const rows = page.locator('.ref-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('CleanUp 1');
  await rows.first().click();
  await expect(page.locator('[role=treeitem][aria-selected=true]')).toHaveAttribute('data-name', 'Sheet1');
  await expect.poll(() => caretLine(page)).toBe(5);
});

test('T-WB-24: the Graph tab shows the VBA call graph without run buttons', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('>graph');
  await page.keyboard.press('Enter');
  await expect(page.locator('[role=tab][data-tab="graph"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.graph-svg .graph-node')).toHaveCount(3);
  await expect(page.locator('.graph-svg .graph-edge')).toHaveCount(2);
  await expect(page.locator('.graph-panel .dock-actions button[hidden]')).toHaveCount(2);
  await page.locator('.graph-svg .graph-node', { hasText: 'LoadData' }).first().dblclick();
  await expect.poll(() => caretLine(page)).toBe(4);
});

test('T-WB-24: the editor context menu offers definition and references', async ({ page }) => {
  await open(page);
  await rightClick(page);
  const menu = page.locator('.menu');
  await expect(menu).toBeVisible();
  await caretAfter(page, 'Call LoadData');
  await menu.getByRole('menuitem', { name: 'Go to the definition of the name under the caret' }).click();
  await expect.poll(() => caretLine(page)).toBe(4);
  await rightClick(page);
  await expect(menu).toHaveCount(1);
  await caretAfter(page, 'Call LoadData');
  await menu.getByRole('menuitem', { name: 'Find the references of the name under the caret' }).click();
  await expect(page.locator('[role=tab][data-tab="references"]')).toHaveAttribute('aria-selected', 'true');
});
