import { test, expect } from '@playwright/test';
import { openApp, fx } from './helpers.js';

const row = (page, name) => page.locator(`.nav-list [role=treeitem][data-name="${name}"]`);
const tab = (page, name) => page.getByRole('tab', { name: new RegExp(`^${name}\\b`) });
const group = (page, i) => page.locator('.editor-group').nth(i);
const area = (page, i) => group(page, i).locator('textarea');
const tabNames = (page, i) => group(page, i).locator('.tab-name').evaluateAll((els) => els.map((e) => e.textContent));
async function dragTab(page, name, target) {
  const src = await tab(page, name).locator('xpath=..').boundingBox();
  const x = src.x + src.width / 2;
  const y = src.y + src.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 12, y + 12, { steps: 4 });
  const dst = await target().boundingBox();
  await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 12 });
  await page.mouse.up();
}

const toTop = (page) => page.locator('.rail').evaluate((el) => {
  el.scrollTop = 0;
});

async function openMany(page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await page.setInputFiles('input[type=file]', fx('many-queries.xlsx'));
  await page.waitForSelector('.nav-list [role=treeitem][data-type=query]');
}

async function openSix(page) {
  await toTop(page);
  for (const n of ['Staging_01', 'Staging_02', 'Staging_03', 'Staging_04', 'Staging_05', 'Staging_06']) await row(page, n).dblclick();
  await expect(page.getByRole('tab')).toHaveCount(6);
}

test('T-WB-12: a single click opens a preview tab that the next click replaces, and a double click keeps it', async ({ page }) => {
  await openMany(page);
  await expect(page.getByRole('tab')).toHaveCount(1);
  await row(page, 'Staging_01').click();
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect(tab(page, 'Staging_01')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.tab[data-key="query:Staging_01"]')).toHaveAttribute('data-preview', 'true');
  await row(page, 'Staging_02').click();
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect(tab(page, 'Staging_02')).toBeVisible();
  await row(page, 'Staging_02').dblclick();
  await expect(page.locator('.tab[data-key="query:Staging_02"]')).toHaveAttribute('data-preview', 'false');
  await row(page, 'Staging_03').click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await area(page, 0).fill('Table.FirstN(Staging_02, 3)');
  await expect(page.locator('.tab[data-key="query:Staging_03"]')).toHaveAttribute('data-preview', 'false');
  await expect(page.locator('.tab[data-key="query:Staging_03"] .tab-edited')).toBeVisible();
  await row(page, 'Staging_04').click();
  await expect(page.getByRole('tab')).toHaveCount(3);
});

test('T-WB-12: open six items, split, edit in both groups, close an edited tab, reopen it and the edit is still there', async ({ page }) => {
  await openMany(page);
  await openSix(page);
  await tab(page, 'Staging_04').click();
  await page.keyboard.press('Control+\\');
  await expect(page.locator('.editor-group')).toHaveCount(2);
  expect(await tabNames(page, 0)).toEqual(['Staging_01', 'Staging_02', 'Staging_03', 'Staging_05', 'Staging_06']);
  expect(await tabNames(page, 1)).toEqual(['Staging_04']);
  await expect(group(page, 1)).toHaveAttribute('data-active', 'true');
  await area(page, 1).fill('Table.FirstN(Staging_01, 4)');
  await expect(page.locator('.tab[data-key="query:Staging_04"] .tab-edited')).toBeVisible();
  await tab(page, 'Staging_02').click();
  await expect(group(page, 0)).toHaveAttribute('data-active', 'true');
  await expect(page.locator('.item-title')).toHaveText('Staging_02');
  await area(page, 0).fill('Table.FirstN(Staging_01, 2)');
  await expect(page.locator('.tab[data-key="query:Staging_02"] .tab-edited')).toBeVisible();
  await expect(area(page, 1)).toHaveValue('Table.FirstN(Staging_01, 4)');
  await page.keyboard.press('Alt+w');
  await expect(page.locator('.tab[data-key="query:Staging_02"]')).toHaveCount(0);
  await expect(page.locator('.tab[data-key="query:Staging_04"] .tab-edited')).toBeVisible();
  await toTop(page);
  await row(page, 'Staging_02').dblclick();
  await expect(tab(page, 'Staging_02')).toHaveAttribute('aria-selected', 'true');
  await expect(area(page, 0)).toHaveValue('Table.FirstN(Staging_01, 2)');
  await expect(page.locator('.tab[data-key="query:Staging_02"] .tab-edited')).toBeVisible();
});

test('T-WB-12: Alt+] and Alt+[ cycle, Alt+number jumps, Alt+W closes, and the only tab cannot be closed', async ({ page }) => {
  await openMany(page);
  await openSix(page);
  await expect(tab(page, 'Staging_06')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Alt+]');
  await expect(page.locator('.item-title')).toHaveText('Staging_01');
  await page.keyboard.press('Alt+[');
  await expect(page.locator('.item-title')).toHaveText('Staging_06');
  await page.keyboard.press('Alt+3');
  await expect(page.locator('.item-title')).toHaveText('Staging_03');
  await page.keyboard.press('Alt+9');
  await expect(page.locator('.item-title')).toHaveText('Staging_03');
  await page.keyboard.press('Alt+w');
  await expect(page.getByRole('tab')).toHaveCount(5);
  for (let i = 0; i < 4; i++) await page.keyboard.press('Alt+w');
  await expect(page.getByRole('tab')).toHaveCount(1);
  await page.keyboard.press('Alt+w');
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Close / })).toHaveCount(0);
});

test('T-WB-12: each tab remembers its caret and scroll position', async ({ page }) => {
  await openMany(page);
  await toTop(page);
  await row(page, 'Sales_Clean').dblclick();
  await row(page, 'Sales_Raw').dblclick();
  await page.locator('.editor-group textarea').evaluate((t) => {
    t.focus();
    t.setSelectionRange(8, 14);
  });
  await tab(page, 'Sales_Clean').click();
  await page.locator('.editor-group textarea').evaluate((t) => {
    t.focus();
    t.setSelectionRange(20, 25);
  });
  await tab(page, 'Sales_Raw').click();
  await expect.poll(() => page.locator('.editor-group textarea').evaluate((t) => [t.selectionStart, t.selectionEnd])).toEqual([8, 14]);
  await tab(page, 'Sales_Clean').click();
  await expect.poll(() => page.locator('.editor-group textarea').evaluate((t) => [t.selectionStart, t.selectionEnd])).toEqual([20, 25]);
});

test('T-WB-12: dragging a tab onto the split zone and between groups moves it', async ({ page }) => {
  await openMany(page);
  await openSix(page);
  await dragTab(page, 'Staging_03', () => page.locator('.drop-split'));
  await expect(page.locator('.editor-group')).toHaveCount(2);
  await expect.poll(() => tabNames(page, 1)).toEqual(['Staging_03']);
  await tab(page, 'Staging_05').locator('xpath=..').dragTo(group(page, 1).locator('.editor-wrap'));
  await expect.poll(() => tabNames(page, 1)).toEqual(['Staging_03', 'Staging_05']);
  await expect(tab(page, 'Staging_05')).toHaveAttribute('aria-selected', 'true');
  await tab(page, 'Staging_03').locator('xpath=..').dragTo(group(page, 0).locator('.editor-wrap'));
  await expect.poll(() => tabNames(page, 1)).toEqual(['Staging_05']);
  await tab(page, 'Staging_05').locator('xpath=..').dragTo(group(page, 0).locator('.editor-wrap'));
  await expect(page.locator('.editor-group')).toHaveCount(1);
});

test('T-WB-12: every drag has a menu equivalent and the keyboard can reach it', async ({ page }) => {
  await openMany(page);
  await openSix(page);
  await tab(page, 'Staging_02').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open in a split to the right' }).click();
  await expect(page.locator('.editor-group')).toHaveCount(2);
  expect(await tabNames(page, 1)).toEqual(['Staging_02']);
  await tab(page, 'Staging_02').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to the other group' }).click();
  await expect(page.locator('.editor-group')).toHaveCount(1);
  await tab(page, 'Staging_02').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(tab(page, 'Staging_06')).toBeFocused();
  await page.keyboard.press('Delete');
  await expect(page.locator('.tab[data-key="query:Staging_06"]')).toHaveCount(0);
});

test('T-WB-12: Ctrl+\\ joins the groups again and a narrow window cannot split', async ({ page }) => {
  await openMany(page);
  await openSix(page);
  await page.keyboard.press('Control+\\');
  await expect(page.locator('.editor-group')).toHaveCount(2);
  await page.keyboard.press('Control+\\');
  await expect(page.locator('.editor-group')).toHaveCount(1);
  expect((await tabNames(page, 0)).length).toBe(6);
  await page.setViewportSize({ width: 700, height: 900 });
  await page.keyboard.press('Control+\\');
  await expect(page.locator('.editor-group')).toHaveCount(1);
  await expect(page.locator('.statusbar')).toContainText('too narrow');
});

test('T-WB-12: a preview tab is italic and the strip is a tablist with the active tab as the one tab stop', async ({ page }) => {
  await openMany(page);
  await row(page, 'Staging_01').click();
  await expect(page.locator('.tab[data-key="query:Staging_01"] .tab-name')).toHaveCSS('font-style', 'italic');
  await expect(page.getByRole('tablist')).toHaveCount(1);
  await expect(page.locator('.tab-main[tabindex="0"]')).toHaveCount(1);
  await row(page, 'Staging_01').dblclick();
  await expect(page.locator('.tab[data-key="query:Staging_01"] .tab-name')).toHaveCSS('font-style', 'normal');
});
