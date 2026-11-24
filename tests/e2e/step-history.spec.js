import { test, expect } from '@playwright/test';
import { ext, openApp, loadFile, item, editor } from './helpers.js';

const QUERY = [
  'let',
  '    Source = #table({"Name", "Age", "City"}, {{"Ann", 30, "Oslo"}, {"Bob", 25, "Rome"}, {"Cy", 30, "Oslo"}}),',
  '    Sorted = Table.Sort(Source, {{"Name", Order.Descending}}),',
  '    Typed = Table.TransformColumnTypes(Sorted, {{"Age", Int64.Type}})',
  'in',
  '    Typed'
].join('\n');

const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const row = (page, name) => page.locator('.step-row').filter({ has: page.locator('.step-name', { hasText: new RegExp(`^${esc(name)}$`) }) });
const undo = (page) => page.getByRole('button', { name: /^Undo/ });
const names = (page) => page.locator('.step-row .step-name').allTextContents();

async function setup(page, file = 'pq_simple.xlsx', name = 'StudentResults') {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await loadFile(page, ext(file));
  await item(page, name).click();
  await editor(page).fill(QUERY);
  await expect(page.locator('.step-row')).toHaveCount(3);
}

test('T-WB-15: Undo appears after a step operation and puts the text back exactly', async ({ page }) => {
  await setup(page);
  const original = await editor(page).inputValue();
  await expect(undo(page)).toBeHidden();
  await row(page, 'Sorted').focus();
  await page.keyboard.press('Delete');
  await expect(page.locator('.step-row')).toHaveCount(2);
  expect(await editor(page).inputValue()).not.toContain('Sorted');
  await expect(undo(page)).toBeVisible();
  await expect(undo(page)).toHaveAttribute('aria-label', 'Undo: Deleted Sorted.');
  await undo(page).click();
  await expect(undo(page)).toBeHidden();
  expect(await editor(page).inputValue()).toBe(original);
  await expect(page.locator('.step-row')).toHaveCount(3);
});

test('T-WB-15: Ctrl+Z with the steps panel focused undoes the operation', async ({ page }) => {
  await setup(page);
  const original = await editor(page).inputValue();
  await row(page, 'Sorted').focus();
  await page.keyboard.press('b');
  await expect(row(page, 'Sorted')).toHaveClass(/is-bypassed/);
  await page.keyboard.press('Control+z');
  expect(await editor(page).inputValue()).toBe(original);
  await expect(row(page, 'Sorted')).not.toHaveClass(/is-bypassed/);
});

test('T-WB-15: Undo refuses when the text was edited by hand after the operation and says so', async ({ page }) => {
  await setup(page);
  await row(page, 'Sorted').focus();
  await page.keyboard.press('Delete');
  await expect(page.locator('.step-row')).toHaveCount(2);
  await editor(page).focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' ');
  const edited = await editor(page).inputValue();
  await undo(page).click();
  expect(await editor(page).inputValue()).toBe(edited);
  await expect(page.locator('.steps-live').first()).toHaveText('The text has changed since that operation, so use the editor undo instead.');
  await expect(undo(page)).toBeHidden();
});

test('T-WB-15: the History popover lists the operations newest first and restores the third of five exactly', async ({ page }) => {
  await setup(page);
  const original = await editor(page).inputValue();
  const texts = [];
  await row(page, 'Sorted').focus();
  await page.keyboard.press('Control+d');
  await expect(page.locator('.step-row')).toHaveCount(4);
  texts.push(await editor(page).inputValue());
  const dup = (await names(page)).find((n) => n !== 'Source' && n !== 'Sorted' && n !== 'Typed');
  expect(dup).toBeTruthy();
  await row(page, 'Sorted').focus();
  await page.keyboard.press('b');
  await expect(row(page, 'Sorted')).toHaveClass(/is-bypassed/);
  texts.push(await editor(page).inputValue());
  await row(page, dup).focus();
  await page.keyboard.press('Delete');
  await expect(page.locator('.step-row')).toHaveCount(3);
  texts.push(await editor(page).inputValue());
  await row(page, 'Sorted').focus();
  await page.keyboard.press('b');
  await expect(row(page, 'Sorted')).not.toHaveClass(/is-bypassed/);
  texts.push(await editor(page).inputValue());
  await row(page, 'Typed').focus();
  await page.keyboard.press('Control+d');
  await expect(page.locator('.step-row')).toHaveCount(4);
  texts.push(await editor(page).inputValue());
  expect(new Set(texts).size).toBe(5);

  await page.getByRole('button', { name: 'History' }).click();
  const pop = page.getByRole('dialog', { name: 'Operation history of this query' });
  await expect(pop.locator('li')).toHaveCount(6);
  await expect(pop.locator('li').first()).toContainText('Duplicated Typed.');
  await expect(pop.locator('li').nth(2)).toContainText(`Deleted ${dup}.`);
  await expect(pop.locator('li').last()).toContainText('Before the first operation');
  await pop.locator('li').nth(2).getByRole('button', { name: /^Restore this version/ }).click();
  expect(await editor(page).inputValue()).toBe(texts[2]);
  await expect(page.locator('.step-row')).toHaveCount(3);

  await page.getByRole('button', { name: 'History' }).click();
  const again = page.getByRole('dialog', { name: 'Operation history of this query' });
  await expect(again.locator('li')).toHaveCount(7);
  await again.locator('li').last().getByRole('button', { name: 'Restore this version: Before the first operation' }).click();
  expect(await editor(page).inputValue()).toBe(original);
});

test('T-WB-15: History appears once a query has an operation, and each query keeps its own', async ({ page }) => {
  await setup(page, 'pq_vba_complex.xlsm', 'RawInput');
  const history = page.getByRole('button', { name: 'History' });
  await expect(history).toBeHidden();
  await row(page, 'Sorted').focus();
  await page.keyboard.press('Delete');
  await expect(page.locator('.step-row')).toHaveCount(2);
  await expect(undo(page)).toBeVisible();
  await expect(history).toBeVisible();
  await item(page, 'FinalTable').click();
  await expect(undo(page)).toBeHidden();
  await expect(history).toBeHidden();
  await item(page, 'RawInput').click();
  await expect(history).toBeVisible();
  await history.click();
  await expect(page.getByRole('dialog', { name: 'Operation history of this query' }).locator('li')).toHaveCount(2);
});
