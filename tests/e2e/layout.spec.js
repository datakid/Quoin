import { test, expect } from '@playwright/test';
import { openApp, fx, ext } from './helpers.js';

const width = (page, sel) => page.locator(sel).evaluate((el) => Math.round(el.getBoundingClientRect().width));
const inRegion = (page, sel) => page.evaluate((s) => !!document.activeElement && !!document.querySelector(s) && document.querySelector(s).contains(document.activeElement), sel);

async function openDesktop(page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await page.setInputFiles('input[type=file]', ext('pq_vba_complex.xlsm'));
  await page.waitForSelector('.nav-list [role=treeitem][data-type=query]');
}

test('T-WB-10: the navigator collapses to a 32 px rail and is restored by key and by pointer', async ({ page }) => {
  await openDesktop(page);
  expect(await width(page, '.rail')).toBeGreaterThan(200);
  await page.keyboard.press('Control+b');
  await expect.poll(() => width(page, '.rail')).toBe(32);
  const expand = page.getByRole('button', { name: 'Expand the navigator' });
  await expect(expand).toBeVisible();
  await expect(expand).toBeFocused();
  await expand.click();
  await expect.poll(() => width(page, '.rail')).toBeGreaterThan(200);
  await page.getByRole('button', { name: 'Collapse the navigator' }).click();
  await expect.poll(() => width(page, '.rail')).toBe(32);
  await page.keyboard.press('Control+b');
  await expect.poll(() => width(page, '.rail')).toBeGreaterThan(200);
});

test('T-WB-10: the inspector collapses to a rail and is restored', async ({ page }) => {
  await openDesktop(page);
  expect(await width(page, '.inspector')).toBeGreaterThan(250);
  await page.keyboard.press('Control+Alt+b');
  await expect.poll(() => width(page, '.inspector')).toBe(32);
  await page.getByRole('button', { name: 'Expand the inspector' }).click();
  await expect.poll(() => width(page, '.inspector')).toBeGreaterThan(250);
});

test('T-WB-10: the result dock collapses to a rail and is restored', async ({ page }) => {
  await openDesktop(page);
  await expect(page.locator('.result-panel')).toBeVisible();
  const before = await page.locator('.editor-groups').evaluate((el) => el.getBoundingClientRect().height);
  await page.keyboard.press('Control+j');
  await expect(page.locator('.result-panel')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Expand the result dock' })).toBeVisible();
  const after = await page.locator('.editor-groups').evaluate((el) => el.getBoundingClientRect().height);
  expect(after).toBeGreaterThan(before);
  await page.getByRole('button', { name: 'Expand the result dock' }).click();
  await expect(page.locator('.result-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Collapse the result dock' }).click();
  await expect(page.locator('.result-panel')).toBeHidden();
  await page.keyboard.press('Control+j');
  await expect(page.locator('.result-panel')).toBeVisible();
});

test('T-WB-10: every pane resizes by keyboard and by pointer', async ({ page }) => {
  await openDesktop(page);
  const rail = page.getByRole('separator', { name: 'Resize rail' });
  const w0 = await width(page, '.rail');
  await rail.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => width(page, '.rail')).toBe(w0 + 16);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => width(page, '.rail')).toBe(w0 - 16);
  const rb = await rail.boundingBox();
  await page.mouse.move(rb.x + rb.width / 2, rb.y + 200);
  await page.mouse.down();
  await page.mouse.move(rb.x + 100, rb.y + 200, { steps: 5 });
  await page.mouse.up();
  expect(await width(page, '.rail')).toBeGreaterThan(w0 + 40);

  const insp = page.getByRole('separator', { name: 'Resize the inspector' });
  const i0 = await width(page, '.inspector');
  await insp.focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => width(page, '.inspector')).toBe(i0 + 16);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => width(page, '.inspector')).toBe(i0 - 16);
  const ib = await insp.boundingBox();
  await page.mouse.move(ib.x + ib.width / 2, ib.y + 200);
  await page.mouse.down();
  await page.mouse.move(ib.x - 80, ib.y + 200, { steps: 5 });
  await page.mouse.up();
  expect(await width(page, '.inspector')).toBeGreaterThan(i0 + 40);

  const split = page.getByRole('separator', { name: 'Resize editor and result' });
  await split.focus();
  const before = await split.getAttribute('aria-valuenow');
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => split.getAttribute('aria-valuenow')).not.toBe(before);
  const sb = await split.boundingBox();
  const h0 = await page.locator('.result-panel').evaluate((el) => el.getBoundingClientRect().height);
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb.x + sb.width / 2, sb.y - 80, { steps: 5 });
  await page.mouse.up();
  const h1 = await page.locator('.result-panel').evaluate((el) => el.getBoundingClientRect().height);
  expect(h1).toBeGreaterThan(h0);
});

test('T-WB-10: F6 and Shift+F6 cycle navigator, editor, inspector, dock and readout and focus is never lost', async ({ page }) => {
  await openDesktop(page);
  await page.locator('.editor-group textarea').focus();
  expect(await inRegion(page, '.editor-groups')).toBe(true);
  await page.keyboard.press('F6');
  await expect.poll(() => inRegion(page, '.inspector')).toBe(true);
  await page.keyboard.press('F6');
  await expect.poll(() => inRegion(page, '.result-panel')).toBe(true);
  await page.keyboard.press('F6');
  await expect.poll(() => inRegion(page, '.statusbar')).toBe(true);
  await page.keyboard.press('F6');
  await expect.poll(() => inRegion(page, '.rail')).toBe(true);
  await page.keyboard.press('F6');
  await expect.poll(() => inRegion(page, '.editor-groups')).toBe(true);
  await page.keyboard.press('Shift+F6');
  await expect.poll(() => inRegion(page, '.rail')).toBe(true);
  await page.keyboard.press('Shift+F6');
  await expect.poll(() => inRegion(page, '.statusbar')).toBe(true);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
});

test('T-WB-10: F6 lands on the expand button of a collapsed pane', async ({ page }) => {
  await openDesktop(page);
  await page.keyboard.press('Control+b');
  await page.locator('.editor-group textarea').focus();
  await page.keyboard.press('Shift+F6');
  await expect(page.getByRole('button', { name: 'Expand the navigator' })).toBeFocused();
  await page.keyboard.press('F6');
  await expect.poll(() => inRegion(page, '.editor-groups')).toBe(true);
});

test('T-WB-10: the run menu lists the batch modes and runs the selected queries', async ({ page }) => {
  await openDesktop(page);
  await page.getByRole('button', { name: 'More ways to run' }).click();
  await expect(page.getByRole('menuitem', { name: 'Run the selected queries' })).toBeEnabled();
  await expect(page.getByRole('menuitem', { name: 'Run every query' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Run every query' }).click();
  await expect(page.locator('.statusbar')).toContainText('ran');
  await page.locator('.nav-list [role=treeitem][data-name="RawInput"]').click();
  await page.getByRole('button', { name: 'More ways to run' }).click();
  await page.getByRole('menuitem', { name: 'Run the selected queries' }).click();
  await expect(page.locator('.statusbar')).not.toContainText('Nothing to run');
  await expect(page.locator('.nav-list [role=treeitem][data-name="RawInput"] .dot-loaded')).toHaveAttribute('data-status', 'ok');
});

test('T-WB-10: at 390 by 844 the bottom bar switches Items, Code, Steps and Result and nothing overflows sideways', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await ctx.newPage();
  await openApp(page);
  await page.setInputFiles('input[type=file]', ext('pq_vba_complex.xlsm'));
  await page.waitForSelector('.nav-list [role=treeitem][data-type=query]', { state: 'attached' });
  const bar = page.getByRole('group', { name: 'Pane' });
  await expect(bar).toBeVisible();
  for (const name of ['Items', 'Code', 'Steps', 'Result']) await expect(bar.getByRole('button', { name, exact: true })).toBeVisible();
  const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(await noSideScroll()).toBe(true);

  await bar.getByRole('button', { name: 'Items', exact: true }).tap();
  await expect(page.locator('.rail')).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Items', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('.rail').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);

  await bar.getByRole('button', { name: 'Steps', exact: true }).tap();
  await expect(page.locator('.rail')).toBeHidden();
  await expect(page.locator('.inspector')).toBeVisible();
  expect(await page.locator('.inspector').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await expect(bar.getByRole('button', { name: 'Steps', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await bar.getByRole('button', { name: 'Result', exact: true }).tap();
  await expect(page.locator('.inspector')).toBeHidden();
  await expect(page.locator('.result-panel')).toBeVisible();
  await expect(page.locator('.editor-groups')).toBeHidden();
  expect(await page.locator('.result-panel').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);

  await bar.getByRole('button', { name: 'Code', exact: true }).tap();
  await expect(page.locator('.editor-groups')).toBeVisible();
  await expect(page.locator('.result-panel')).toBeHidden();
  expect(await page.locator('.editor-groups').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await noSideScroll()).toBe(true);
  const boxes = await bar.locator('button:not([hidden])').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  expect(Math.min(...boxes)).toBeGreaterThanOrEqual(32);
  await expect(bar.locator('.bar-problems')).toBeVisible();
  await ctx.close();
});
