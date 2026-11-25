import { test, expect } from '@playwright/test';
import { openApp, ext, item, editor } from './helpers.js';

const width = (page, sel) => page.locator(sel).evaluate((el) => Math.round(el.getBoundingClientRect().width));
const more = (page) => page.getByRole('button', { name: 'More actions' });
const main = (page) => page.locator('.workspace > section.main');
const top = (page) => main(page).evaluate((el) => el.style.getPropertyValue('--top'));
const dockState = async (page) => (await main(page).getAttribute('data-dock')) || 'expanded';
const inspector = (page) => page.locator('.workspace').getAttribute('data-inspector');

async function open(page, w = 1400) {
  await page.setViewportSize({ width: w, height: 900 });
  await openApp(page);
  await page.setInputFiles('input[type=file]', ext('pq_vba_complex.xlsm'));
  await page.waitForSelector('.nav-list [role=treeitem][data-type=query]', { state: 'attached' });
  if (w >= 1100) await item(page, 'RawInput').click();
}

async function preset(page, name) {
  await more(page).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

test('T-WB-10: the More menu lists the three layouts and the changes actions, and is hidden until a workbook is open', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await expect(more(page)).toBeHidden();
  await page.setInputFiles('input[type=file]', ext('pq_vba_complex.xlsm'));
  await page.waitForSelector('.nav-list [role=treeitem][data-type=query]');
  await more(page).click();
  const names = await page.getByRole('menuitem').allTextContents();
  expect(names).toEqual(['Write', 'Debug', 'Review', 'Sources\u2026', 'No changes to review', 'Revert all changes']);
  await expect(page.getByRole('menuitem', { name: 'No changes to review' })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Revert all changes' })).toBeDisabled();
});

test('T-WB-10: Write shows the navigator and the editor only', async ({ page }) => {
  await open(page);
  await preset(page, 'Debug');
  await preset(page, 'Write');
  expect(await width(page, '.rail')).toBeGreaterThan(200);
  expect(await inspector(page)).toBe('closed');
  expect(await dockState(page)).toBe('collapsed');
  await expect(page.locator('#status')).toContainText('Layout: Write.');
});

test('T-WB-10: Debug collapses the navigator and shows the steps and the Result tab at half height', async ({ page }) => {
  await open(page);
  await preset(page, 'Debug');
  await expect.poll(() => width(page, '.rail')).toBe(32);
  expect(await inspector(page)).toBe('open');
  expect(await dockState(page)).toBe('expanded');
  await expect(page.getByRole('tab', { name: /^Result/ })).toHaveAttribute('aria-selected', 'true');
  expect(await top(page)).toBe('50fr');
});

test('T-WB-10: Review opens the dock on Changes at 70 percent, and choosing Write afterwards restores the other panes', async ({ page }) => {
  await open(page);
  await preset(page, 'Review');
  expect(await dockState(page)).toBe('expanded');
  await expect(page.getByRole('tab', { name: /^Changes/ })).toHaveAttribute('aria-selected', 'true');
  expect(await top(page)).toBe('30fr');
  expect(await inspector(page)).toBe('closed');
  await expect.poll(() => width(page, '.rail')).toBe(32);
  await preset(page, 'Write');
  expect(await width(page, '.rail')).toBeGreaterThan(200);
  expect(await dockState(page)).toBe('collapsed');
});

test('T-WB-10: the layouts are palette commands too', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('layout: debug');
  await expect(page.locator('.palette-row.is-active')).toContainText('Layout: debug');
  await page.keyboard.press('Enter');
  await expect(page.locator('dialog.palette')).toHaveCount(0);
  expect(await dockState(page)).toBe('expanded');
  expect(await top(page)).toBe('50fr');
});

test('T-WB-10: with edits, Review changes opens the Changes tab and Revert all asks and then reverts', async ({ page }) => {
  await open(page);
  const original = await editor(page).inputValue();
  await editor(page).fill(`${original.replace(/\s+$/, '')}\n// edited`);
  await more(page).click();
  const review = page.getByRole('menuitem', { name: 'Review 1 change' });
  await expect(review).toBeEnabled();
  await review.click();
  await expect(page.getByRole('tab', { name: /^Changes/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.dock-panel[data-panel=changes] .change-item')).toHaveCount(1);
  await more(page).click();
  await page.getByRole('menuitem', { name: 'Revert all changes' }).click();
  await page.getByRole('dialog', { name: 'Revert all changes' }).getByRole('button', { name: 'Revert all' }).click();
  await expect.poll(() => editor(page).inputValue()).toBe(original);
  await more(page).click();
  await expect(page.getByRole('menuitem', { name: 'No changes to review' })).toBeDisabled();
});

test('T-WB-10: on a narrow window the layouts are disabled and the palette command says why', async ({ page }) => {
  await open(page, 900);
  await more(page).click();
  await expect(page.getByRole('menuitem', { name: 'Write', exact: true })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Debug', exact: true })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Review', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('layout: write');
  await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toContainText('Layout presets need a window wider than 1100 pixels.');
});
