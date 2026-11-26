import { test, expect } from '@playwright/test';
import { ext, openApp, loadFile, editor } from './helpers.js';

const popup = (page) => page.locator('.autocomplete');
const live = (page) => page.locator('.ac-live');
const text = 'let\n    Source = Excel.CurrentWorkbook(){[Name="StudentNames"]}[Content],\n    #"Kept Rows" = Table.SelectRows(Source, each [Age] > 0),\n    Added = Table.AddColumn(#"Kept Rows", "Note", each [Name])\nin\n    Added';

async function open(page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  const problems = await openApp(page);
  await loadFile(page, ext('pq_simple.xlsx'));
  await page.locator('[role=treeitem][data-name="StudentResults"]').click();
  return problems;
}

async function fill(page) {
  await editor(page).fill(text);
  await expect(popup(page)).toBeHidden();
}

const caretAfter = (page, marker, back = 0) => page.evaluate(({ marker, back }) => {
  const ta = document.querySelector('.editor-wrap textarea');
  const at = ta.value.lastIndexOf(marker) + marker.length - back;
  ta.focus();
  ta.setSelectionRange(at, at);
}, { marker, back });

test('T-WB-20: completion inside the record brackets offers the input step columns once a run put them in the store', async ({ page }) => {
  const problems = await open(page);
  await fill(page);
  await caretAfter(page, 'each [');
  await page.keyboard.press('Control+Space');
  await expect(popup(page)).toBeVisible();
  await expect(popup(page).locator('[role=option][aria-selected=true]')).toHaveAttribute('aria-label', /, Step$/);
  await page.keyboard.press('Escape');
  await expect(popup(page)).toBeHidden();
  await page.getByRole('button', { name: 'Evaluate steps' }).click();
  await expect(page.getByRole('button', { name: /^Ran Added/ })).toBeVisible();
  await caretAfter(page, 'each [');
  await page.keyboard.press('Control+Space');
  await expect(popup(page).locator('[role=option]').first()).toHaveAttribute('aria-label', /^Name, Column/);
  await page.keyboard.press('ArrowDown');
  await expect(popup(page).locator('[role=option][aria-selected=true]')).toHaveAttribute('aria-label', /^Age, Column/);
  await page.keyboard.press('Escape');
  await expect(popup(page)).toBeHidden();
  await caretAfter(page, 'each [');
  await page.keyboard.press('Control+Space');
  await page.keyboard.press('Enter');
  await expect(popup(page)).toBeHidden();
  expect(await editor(page).inputValue()).toContain('each [Name]');
  expect(problems).toEqual([]);
});

test('T-WB-20: typing opens the popup, it is announced, Escape dismisses it and Enter accepts', async ({ page }) => {
  const problems = await open(page);
  await fill(page);
  await editor(page).press('Control+End');
  await page.keyboard.type(', W = Text.Up');
  await expect(popup(page)).toBeVisible();
  await expect(popup(page).locator('.ac-text').first()).toHaveText(/Text\.Up/);
  await expect(live(page)).toHaveText(/\d+ suggestions?\. /);
  await expect(editor(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(editor(page)).toHaveAttribute('aria-activedescendant', /.+/);
  await page.keyboard.press('Escape');
  await expect(popup(page)).toBeHidden();
  expect(await editor(page).getAttribute('aria-expanded')).toBe(null);
  await page.keyboard.type(', W = Text.Up');
  await expect(popup(page)).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(popup(page)).toBeHidden();
  expect(await editor(page).inputValue()).toContain('Text.Upper');
  expect(problems).toEqual([]);
});

test('T-WB-20: a quoted identifier in progress inserts closed quotes around the step name', async ({ page }) => {
  await open(page);
  await fill(page);
  await editor(page).press('Control+End');
  await page.keyboard.type(' + #"Ke');
  await expect(popup(page)).toBeVisible();
  await expect(popup(page).locator('.ac-text').first()).toHaveText('Kept Rows');
  await page.keyboard.press('Enter');
  expect(await editor(page).inputValue()).toContain(' + #"Kept Rows"');
});

test('T-WB-20: library names complete after a dot in a category prefix', async ({ page }) => {
  await open(page);
  await fill(page);
  await editor(page).press('Control+End');
  await page.keyboard.type(', V = Text.U');
  await expect(popup(page)).toBeVisible();
  const row = popup(page).locator('[role=option]').first();
  await expect(row).toHaveAttribute('aria-label', /Text\.Upper, Library: Function/);
  await expect(popup(page).locator('.ac-detail').first()).toHaveText('(text, culture?)');
  await page.keyboard.press('Enter');
  expect(await editor(page).inputValue()).toContain('Text.Upper');
});
