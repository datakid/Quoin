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

test('T-WB-20: F12 jumps to the binding of the name under the caret', async ({ page }) => {
  const problems = await open(page);
  await fill(page);
  await caretAfter(page, 'Table.AddColumn(#"K');
  await page.keyboard.press('F12');
  const line = await page.evaluate(() => document.querySelector('.editor-wrap textarea').value.slice(0, document.querySelector('.editor-wrap textarea').selectionStart).split(/\r\n|\r|\n/).length);
  expect(line).toBe(3);
  const col = await page.evaluate(() => {
    const ta = document.querySelector('.editor-wrap textarea');
    const start = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    return ta.selectionStart - start;
  });
  expect(col).toBeGreaterThanOrEqual(4);
  expect(problems).toEqual([]);
});

test('T-WB-20: F12 on a query name opens its tab and the signature of a library function', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const problems = await openApp(page);
  await loadFile(page, ext('pq_vba_complex.xlsm'));
  const names = await page.locator('[role=treeitem][data-type=query]').evaluateAll((els) => els.map((e) => e.dataset.name));
  for (const name of names) {
    await page.locator(`[role=treeitem][data-name="${name}"]`).click();
    await editor(page).fill(name === 'FinalTable' ? 'let\n    Source = RawInput,\n    Trimmed = Table.SelectRows(Source, each [Amount] > 0)\nin\n    Trimmed' : '1');
  }
  await page.locator('[role=treeitem][data-name="FinalTable"]').click();
  await caretAfter(page, 'Source = RawInput');
  await page.keyboard.press('F12');
  await expect(page.locator('[role=treeitem][aria-selected=true]')).toHaveAttribute('data-name', 'RawInput');
  await page.locator('[role=treeitem][data-name="FinalTable"]').click();
  await caretAfter(page, 'Source = RawInput');
  await page.keyboard.press('Shift+F12');
  await expect(page.locator('[role=tab][data-tab="references"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.refs-head')).toContainText('1 place');
  await page.locator('.ref-row').first().click();
  await expect(page.locator('[role=treeitem][aria-selected=true]')).toHaveAttribute('data-name', 'FinalTable');
  await caretAfter(page, 'Table.SelectRows');
  await page.keyboard.press('F12');
  await expect(page.locator('.signature')).toBeVisible();
  await expect(page.locator('.signature .sig-name')).toHaveText('Table.SelectRows');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('.signature')).toBeHidden();
  expect(problems).toEqual([]);
});

test('T-WB-20: Shift+F12 lists the exact references and F2 on a query name explains itself', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await loadFile(page, ext('pq_vba_complex.xlsm'));
  const names = await page.locator('[role=treeitem][data-type=query]').evaluateAll((els) => els.map((e) => e.dataset.name));
  for (const name of names) {
    await page.locator(`[role=treeitem][data-name="${name}"]`).click();
    await editor(page).fill(name === 'FinalTable' ? 'let\n    Source = RawInput,\n    // RawInput here is only a comment, "RawInput" only a string\n    Trimmed = Table.SelectRows(Source, each [Amount] > 0)\nin\n    Trimmed' : '1');
  }
  await page.locator('[role=treeitem][data-name="FinalTable"]').click();
  await caretAfter(page, 'Source = RawInput');
  await page.keyboard.press('Shift+F12');
  const rows = page.locator('.ref-row');
  await expect(rows).toHaveCount(1);
  await expect(page.locator('.ref-row .ref-item')).toHaveText(['FinalTable']);
  await page.locator('.ref-row').first().click();
  await expect(page.locator('[role=treeitem][aria-selected=true]')).toHaveAttribute('data-name', 'FinalTable');
  await caretAfter(page, 'Source = RawInput');
  await page.keyboard.press('F2');
  await expect(page.locator('.statusbar')).toContainText('F2 renames a step');
  await caretAfter(page, 'Trimmed = Table.');
  await page.keyboard.press('F2');
  await expect(page.locator('.statusbar')).toContainText('Only the steps of the query');
});

test('T-WB-20: F2 in the editor renames the step under the caret and rewrites its readers', async ({ page }) => {
  await open(page);
  await fill(page);
  await caretAfter(page, 'Table.AddColumn(#"K');
  await page.keyboard.press('F2');
  const input = page.locator('.rename-pop .step-rename');
  await expect(input).toHaveValue('Kept Rows');
  await input.fill('Typed Rows');
  await page.keyboard.press('Enter');
  await expect(page.locator('.rename-pop')).toHaveCount(0);
  const after = await editor(page).inputValue();
  expect(after).toContain('#"Typed Rows" = Table.SelectRows');
  expect(after).toContain('Table.AddColumn(#"Typed Rows"');
  expect(after).not.toContain('Kept Rows');
  await page.locator('.step-row').nth(1).focus();
  await page.keyboard.press('Control+z');
  expect(await editor(page).inputValue()).toContain('Kept Rows');
});

test('T-WB-20: typing an opening paren shows the signature with the current parameter', async ({ page }) => {
  const problems = await open(page);
  await fill(page);
  await editor(page).press('Control+End');
  await page.keyboard.type(', V = Text.PadStart(');
  await expect(page.locator('.signature')).toBeVisible();
  await expect(page.locator('.signature .sig-name')).toHaveText('Text.PadStart');
  await expect(page.locator('.signature .sig-param.is-current')).toHaveText('text');
  await page.keyboard.type('x, 3, "0');
  await expect(page.locator('.signature .sig-param.is-current')).toHaveText('character?');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('.signature')).toBeHidden();
  expect(problems).toEqual([]);
});
