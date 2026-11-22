import { test, expect } from '@playwright/test';
import { ext, openApp, loadFile } from './helpers.js';

const text = (page) => page.locator('.editor-wrap textarea').inputValue();
const rows = (page) => page.locator('.step-row');
const names = (page) => rows(page).locator('.step-name').evaluateAll((els) => els.map((e) => e.textContent));
const caretLine = (page) => page.evaluate(() => {
  const ta = document.querySelector('.editor-wrap textarea');
  return ta.value.slice(0, ta.selectionStart).split(/\r\n|\r|\n/).length;
});

async function open(page, size = { width: 1400, height: 900 }) {
  await page.setViewportSize(size);
  await openApp(page);
  await loadFile(page, ext('pq_simple.xlsx'));
  if (size.width < 1024) await page.locator('.rail-toggle-wide').click();
  await page.locator('[role=treeitem][data-type=query]').first().click();
}

async function dragStep(page, from, to, half) {
  const target = rows(page).nth(to).locator('xpath=..');
  const box = await target.boundingBox();
  await rows(page).nth(from).locator('xpath=..').dragTo(target, { targetPosition: { x: box.width / 2, y: half === 'bottom' ? box.height - 3 : 3 } });
}

test('T-WB-15: F10 and Shift+F10 move the step cursor from the editor, show the step result without a new run, and stop at the ends', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Evaluate steps' }).click();
  await expect(page.locator('.bead-ok')).toHaveCount(3);
  await page.locator('.editor-wrap textarea').focus();
  await page.keyboard.press('Control+Home');
  await expect(rows(page).first()).toHaveClass(/is-current/);
  await page.keyboard.press('F10');
  await expect(page.locator('.step-row.is-current')).toContainText('Changed Type');
  expect(await caretLine(page)).toBe(3);
  await expect(page.locator('.dock-panel[data-panel=result] [role=grid]').first()).toBeVisible();
  const columns = async () => page.locator('.dock-panel[data-panel=result] [role=columnheader]').allTextContents();
  const afterTypes = await columns();
  await page.keyboard.press('F10');
  await expect(page.locator('.step-row.is-current')).toContainText('Added Custom');
  await expect.poll(async () => (await columns()).length).toBeGreaterThan(afterTypes.length);
  await page.keyboard.press('F10');
  await expect(page.locator('.step-row.is-current')).toContainText('Added Custom');
  await page.keyboard.press('Shift+F10');
  await expect(page.locator('.step-row.is-current')).toContainText('Changed Type');
  await expect.poll(async () => (await columns()).length).toBe(afterTypes.length);
  await page.keyboard.press('Shift+F10');
  await page.keyboard.press('Shift+F10');
  await expect(rows(page).first()).toHaveClass(/is-current/);
});

test('T-WB-15: J and K walk the steps when the panel has focus, and a step with no result says so', async ({ page }) => {
  await open(page);
  await rows(page).first().focus();
  await page.keyboard.press('j');
  await expect(page.locator('.step-row.is-current')).toContainText('Changed Type');
  await expect(page.locator('.statusbar')).toContainText('no result yet');
  await page.keyboard.press('k');
  await expect(rows(page).first()).toHaveClass(/is-current/);
});

test('T-WB-15: Shift+F10 outside the editor and the panel is left to the browser', async ({ page }) => {
  await open(page);
  await page.locator('.nav-list [role=treeitem]').first().focus();
  const prevented = await page.evaluate(() => new Promise((resolve) => {
    const handler = (e) => {
      document.removeEventListener('keydown', handler);
      setTimeout(() => resolve(e.defaultPrevented), 0);
    };
    document.addEventListener('keydown', handler);
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', code: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
  }));
  expect(prevented).toBe(false);
});

test('T-WB-15: dragging a step by its grip moves it, with the drop position checked while dragging', async ({ page }) => {
  await open(page);
  await expect(page.locator('.step-grip')).toHaveCount(3);
  const before = await names(page);
  expect(before).toEqual(['Source', 'Changed Type', 'Added Custom']);
  await dragStep(page, 2, 0, 'top');
  await expect(page.locator('.step-drop-note')).toBeHidden();
  expect(await names(page)).toEqual(before);
  await dragStep(page, 2, 1, 'top');
  await page.getByRole('button', { name: 'Move and rewire' }).click();
  await expect.poll(() => names(page)).toEqual(['Source', 'Added Custom', 'Changed Type']);
  expect(await text(page)).toContain('Table.TransformColumnTypes(#"Added Custom"');
});

test('T-WB-15: while dragging, a position that cannot be used is marked and refused with the reason', async ({ page }) => {
  await open(page);
  const grip = rows(page).nth(1).locator('xpath=..');
  const target = rows(page).first().locator('xpath=..');
  const tb = await target.boundingBox();
  const gb = await grip.boundingBox();
  await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await page.mouse.down();
  await page.mouse.move(gb.x + 10, gb.y + 10, { steps: 3 });
  await page.mouse.move(tb.x + tb.width / 2, tb.y + 4, { steps: 8 });
  await expect(page.locator('.step-item.drop-bad')).toHaveCount(1);
  await expect(page.locator('.step-drop-note')).toContainText('Nothing can go above');
  await page.mouse.up();
  expect(await names(page)).toEqual(['Source', 'Changed Type', 'Added Custom']);
  await expect(page.locator('.step-item.drop-bad')).toHaveCount(0);
});

test('T-WB-15: Insert opens an inline editor, adds the step after the current one and rewires the next step', async ({ page }) => {
  await open(page);
  await rows(page).nth(1).focus();
  await page.keyboard.press('Insert');
  await expect(page.getByLabel('Name of the new step')).toHaveValue('Step4');
  await expect(page.getByLabel('Expression of the new step')).toHaveValue('#"Changed Type"');
  await page.getByLabel('Name of the new step').fill('Kept');
  await page.getByLabel('Expression of the new step').fill('Table.FirstN(#"Changed Type", 2)');
  await page.keyboard.press('Enter');
  await expect.poll(() => names(page)).toEqual(['Source', 'Changed Type', 'Kept', 'Added Custom']);
  const t = await text(page);
  expect(t).toContain('Kept = Table.FirstN(#"Changed Type", 2)');
  expect(t).toContain('Table.AddColumn(Kept,');
  await expect(rows(page).nth(2)).toBeFocused();
});

test('T-WB-15: Escape cancels an insert and a name that already exists is refused with the reason', async ({ page }) => {
  await open(page);
  await rows(page).first().focus();
  await page.keyboard.press('Insert');
  await page.keyboard.press('Escape');
  await expect(page.locator('.step-insert')).toHaveCount(0);
  await expect(rows(page).first()).toBeFocused();
  await page.keyboard.press('Insert');
  await page.getByLabel('Name of the new step').fill('Changed Type');
  await page.keyboard.press('Enter');
  await expect(page.locator('.statusbar')).toContainText('already exists');
  expect(await names(page)).toEqual(['Source', 'Changed Type', 'Added Custom']);
});

test('T-WB-15: the Insert step after entry is in the step menu', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /^Actions for step Source/ }).click();
  await page.getByRole('menuitem', { name: 'Insert step after' }).click();
  await expect(page.locator('.step-insert')).toHaveCount(1);
});

test('T-WB-14: between 640 and 1099 px the Steps button opens the inspector as a sheet that Escape closes', async ({ page }) => {
  await open(page, { width: 900, height: 900 });
  await expect(page.locator('.inspector')).toBeHidden();
  const toggle = page.locator('.inspector-toggle');
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.locator('.inspector')).toBeVisible();
  await expect(rows(page)).toHaveCount(3);
  expect(await page.locator('.inspector').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('.inspector')).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.click();
  await toggle.click();
  await expect(page.locator('.inspector')).toBeHidden();
});
