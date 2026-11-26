import { test, expect } from '@playwright/test';
import { ext, fx, openApp, loadFile, item, editor } from './helpers.js';

const STEPS = [
  'let',
  '    Source = #table({"Name", "Age", "City"}, {{"Ann", 30, "Oslo"}, {"Bob", 25, "Rome"}}),',
  '    #"Sorted Rows" = Table.Sort(Source, {{"Name", Order.Ascending}}),',
  '    Next = Source',
  'in',
  '    Next'
].join('\n');

const list = (page) => page.getByRole('listbox', { name: 'Suggestions' });
const options = (page) => list(page).getByRole('option');
const live = (page) => page.locator('.editor-wrap .intel-live').first();

async function setup(page, text, { file = 'pq_simple.xlsx', name = 'StudentResults', csv = false, settle = false } = {}) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await loadFile(page, csv ? fx(file) : ext(file));
  await item(page, name).click();
  await editor(page).fill(text);
  if (settle) await expect(page.locator('.step-row')).not.toHaveCount(0);
}

async function caretAt(page, offset) {
  await editor(page).evaluate((el, o) => {
    el.focus();
    el.setSelectionRange(o, o);
  }, offset);
}

async function caretAfter(page, needle, nth = 0) {
  const text = await editor(page).inputValue();
  let i = -1;
  for (let k = 0; k <= nth; k++) i = text.indexOf(needle, i + 1);
  await caretAt(page, i + needle.length);
}

test('T-WB-20: typing a library prefix opens a suggestions list tied to the editor, Tab inserts the first and closes it', async ({ page }) => {
  await setup(page, '');
  await editor(page).focus();
  await page.keyboard.type('Table.SelectR');
  await expect(list(page)).toBeVisible();
  await expect(options(page).first()).toContainText('Table.SelectRows');
  await expect(options(page).first()).toHaveAttribute('aria-selected', 'true');
  const active = await options(page).first().getAttribute('id');
  await expect(editor(page)).toHaveAttribute('aria-activedescendant', active);
  await expect(editor(page)).toHaveAttribute('aria-controls', /cmp-list-/);
  await expect(live(page)).toContainText(/\d+ suggestions?/);
  await page.keyboard.press('Tab');
  await expect(list(page)).toHaveCount(0);
  expect(await editor(page).inputValue()).toBe('Table.SelectRows');
  await expect(editor(page)).not.toHaveAttribute('aria-activedescendant', /.+/);
});

test('T-WB-20: Escape dismisses the suggestions and keeps the typed text, and a string literal never opens them', async ({ page }) => {
  await setup(page, '');
  await editor(page).focus();
  await page.keyboard.type('Text.Up');
  await expect(list(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(list(page)).toHaveCount(0);
  await expect(live(page)).toHaveText('Suggestions closed');
  expect(await editor(page).inputValue()).toBe('Text.Up');
  await editor(page).fill('');
  await page.keyboard.type('"Tab');
  await expect(list(page)).toHaveCount(0);
});

test('T-WB-20: Ctrl+Space lists everything, the arrows move the choice and Enter inserts it', async ({ page }) => {
  await setup(page, '');
  await editor(page).focus();
  await page.keyboard.press('Control+Space');
  await expect(list(page)).toBeVisible();
  const second = (await options(page).nth(1).locator('.cmp-label').textContent()).trim();
  await page.keyboard.press('ArrowDown');
  await expect(options(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(options(page).first()).toHaveAttribute('aria-selected', 'false');
  await page.keyboard.press('Enter');
  await expect(list(page)).toHaveCount(0);
  expect(await editor(page).inputValue()).toBe(second);
});

test('T-WB-20: steps before the caret are offered and a name that needs quotes is inserted quoted', async ({ page }) => {
  await setup(page, STEPS);
  await caretAfter(page, 'Next = ');
  await page.keyboard.type('Sor');
  await expect(options(page).first()).toContainText('Sorted Rows');
  await expect(options(page).first()).toContainText('step');
  await page.keyboard.press('Enter');
  const text = await editor(page).inputValue();
  expect(text).toContain('Next = #"Sorted Rows"Source');
});

test('T-WB-20: a step is not offered inside its own definition or before it', async ({ page }) => {
  await setup(page, STEPS);
  await caretAfter(page, 'Source = ');
  await page.keyboard.type('Sor');
  await expect(list(page)).toBeVisible();
  const labels = await options(page).locator('.cmp-label').allTextContents();
  expect(labels.join('|')).not.toContain('Sorted Rows');
  await page.keyboard.press('Escape');
});

test('T-WB-20: inside brackets the columns of the step input are offered once the steps have run, and narrow as you type', async ({ page }) => {
  await setup(page, STEPS);
  await page.getByRole('button', { name: 'Evaluate steps' }).click();
  await expect(page.locator('.bead-ok')).toHaveCount(3);
  await editor(page).fill(STEPS.replace('Next = Source', 'Next = Table.SelectRows(Source, each true)'));
  await caretAfter(page, 'each ');
  await page.keyboard.type('[');
  await expect(list(page)).toBeVisible();
  expect(await options(page).locator('.cmp-label').allTextContents()).toEqual(['Name', 'Age', 'City']);
  await page.keyboard.type('Ci');
  await expect(options(page)).toHaveCount(1);
  await page.keyboard.press('Enter');
  expect(await editor(page).inputValue()).toContain('each [Citytrue)');
});

test('T-WB-20: columns with spaces are inserted quoted', async ({ page }) => {
  const text = 'let\n    Source = #table({"First Name", "Age"}, {{"Ann", 30}}),\n    Next = Table.SelectRows(Source, each true)\nin\n    Next';
  await setup(page, text);
  await page.getByRole('button', { name: 'Evaluate steps' }).click();
  await expect(page.locator('.bead-ok')).toHaveCount(2);
  await caretAfter(page, 'each ');
  await page.keyboard.type('[Fi');
  await expect(options(page).first()).toContainText('First Name');
  await page.keyboard.press('Enter');
  expect(await editor(page).inputValue()).toContain('each [#"First Name"true)');
});

test('T-WB-20: no suggestions for a read-only item or a macro module', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await loadFile(page, ext('pq_vba_complex.xlsm'));
  await item(page, 'Sheet1').click();
  await editor(page).focus();
  await page.keyboard.type('Table.Sel');
  await expect(list(page)).toHaveCount(0);
});

test('T-WB-20: inside a call the signature shows with the current parameter emphasised and announced', async ({ page }) => {
  await setup(page, '');
  await editor(page).focus();
  await page.keyboard.type('Table.SelectRows(');
  await page.keyboard.press('Escape');
  const tip = page.locator('.sig-tip');
  await expect(tip).toHaveText('Table.SelectRows(table, condition)');
  await expect(tip.locator('.sig-active')).toHaveText('table');
  await expect(live(page)).toHaveText('table, parameter 1 of 2');
  await page.keyboard.type('Source, ');
  await page.keyboard.press('Escape');
  await expect(tip.locator('.sig-active')).toHaveText('condition');
  await expect(live(page)).toHaveText('condition, parameter 2 of 2');
  await page.keyboard.type('each true)');
  await expect(tip).toHaveCount(0);
});

test('T-WB-20: optional parameters are shown in square brackets', async ({ page }) => {
  await setup(page, '');
  await editor(page).focus();
  await page.keyboard.type('Table.AddColumn(');
  await page.keyboard.press('Escape');
  await expect(page.locator('.sig-tip')).toHaveText('Table.AddColumn(table, newColumnName, columnGenerator, [columnType])');
});

test('T-WB-20: F12 on a step name jumps to its binding, and on the binding itself says so', async ({ page }) => {
  await setup(page, STEPS);
  await caretAfter(page, 'Next = Sour');
  await page.keyboard.press('F12');
  const pos = await editor(page).evaluate((el) => el.selectionStart);
  expect(pos).toBe(STEPS.indexOf('Source ='));
  await expect(page.locator('#status')).toContainText('Went to the step Source.');
  await page.keyboard.press('F12');
  await expect(page.locator('#status')).toContainText('Source is defined here.');
});

test('T-WB-20: F12 on a query name opens that query', async ({ page }) => {
  await setup(page, 'Sales', { file: 'csv-query.xlsx', name: 'StudentResults', csv: true });
  await caretAfter(page, 'Sal');
  await page.keyboard.press('F12');
  await expect(page.locator('.nav-list [role=treeitem][aria-selected=true]')).toContainText('Sales');
  await expect(page.locator('#status')).toContainText('Opened the query Sales.');
});

test('T-WB-20: Ctrl+click on a name does the same as F12', async ({ page }) => {
  await setup(page, 'Sales', { file: 'csv-query.xlsx', name: 'StudentResults', csv: true });
  await editor(page).click({ position: { x: 36, y: 22 }, modifiers: ['Control'] });
  await expect(page.locator('.nav-list [role=treeitem][aria-selected=true]')).toContainText('Sales');
});

test('T-WB-20: F12 on a library function shows its signature, and on an unknown name says there is no definition', async ({ page }) => {
  await setup(page, 'Table.SelectRows(Mystery, each true)');
  await caretAfter(page, 'Table.Sel');
  await page.keyboard.press('F12');
  await expect(page.locator('#status')).toContainText('Table.SelectRows(table, condition) \u00b7 Table function');
  await caretAfter(page, 'Myst');
  await page.keyboard.press('F12');
  await expect(page.locator('#status')).toContainText('No definition found for Mystery.');
});

const REFS = [
  'let',
  '    Source = #table({"A"}, {{1}}),',
  '    One = Table.AddColumn(Source, "B", each 1),',
  '    Two = Table.AddColumn(One, "C", each Source[A]),',
  '    // Source here is only a comment',
  '    Three = Table.Combine({Source, Two, #table({"Source"}, {})})',
  'in',
  '    Three'
].join('\n');

test('T-WB-20: Shift+F12 lists exactly the references to a step, not its definition, comments or strings', async ({ page }) => {
  await setup(page, REFS);
  await caretAfter(page, 'Source = #table', 0);
  await caretAt(page, REFS.indexOf('Source =') + 2);
  await page.keyboard.press('Shift+F12');
  await expect(page.getByRole('tab', { name: /^References/ })).toHaveAttribute('aria-selected', 'true');
  const panel = page.locator('.dock-panel[data-panel=references]');
  await expect(panel).toContainText('References to Source');
  await expect(panel.locator('.ref-row')).toHaveCount(3);
  expect(await panel.locator('.ref-line').allTextContents()).toEqual(['3', '4', '6']);
  await expect(page.locator('#status')).toContainText('3 references to Source in 1 query.');
  await expect(page.getByRole('tab', { name: /^References/ }).locator('.dock-count')).toHaveText('3');
  await panel.locator('.ref-row').nth(1).click();
  const pos = await editor(page).evaluate((el) => el.selectionStart);
  const line = (await editor(page).inputValue()).slice(0, pos).split('\n').length;
  expect(line).toBe(4);
});

test('T-WB-20: Shift+F12 on a query counts its uses across every query and not its own text', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await loadFile(page, ext('pq_vba_complex.xlsm'));
  await item(page, 'FinalTable').click();
  await caretAfter(page, 'Raw = RawInp');
  await page.keyboard.press('Shift+F12');
  const panel = page.locator('.dock-panel[data-panel=references]');
  await expect(panel.locator('.ref-row')).toHaveCount(1);
  await expect(panel.locator('.ref-query')).toContainText('FinalTable');
  await panel.locator('.ref-row').click();
  await expect(page.locator('.nav-list [role=treeitem][aria-selected=true]')).toContainText('FinalTable');
});

test('T-WB-20: nothing refers to an unused name and the list says so', async ({ page }) => {
  await setup(page, 'let\n    Alone = 1,\n    Other = 2\nin\n    Other');
  await expect(page.locator('.step-row')).toHaveCount(2);
  await caretAt(page, 'let\n    Al'.length);
  await page.keyboard.press('Shift+F12');
  await expect(page.locator('.dock-panel[data-panel=references]')).toContainText('Nothing refers to Alone.');
});

test('T-WB-20: F2 on a step name renames it through the steps panel and every reference follows', async ({ page }) => {
  await setup(page, REFS, { settle: true });
  await expect(page.locator('.step-row')).toHaveCount(4);
  await page.waitForTimeout(400);
  await caretAt(page, REFS.indexOf('One =') + 1);
  await page.keyboard.press('F2');
  const input = page.locator('.step-rename');
  await expect(input).toBeVisible();
  await expect(input).toHaveValue('One');
  await input.fill('Uno');
  await page.keyboard.press('Enter');
  const text = await editor(page).inputValue();
  expect(text).toContain('Uno = Table.AddColumn(Source');
  expect(text).toContain('Table.AddColumn(Uno, "C"');
});

test('T-WB-20: F2 on a query name explains why queries cannot be renamed, and elsewhere asks for a step name', async ({ page }) => {
  await setup(page, 'Sales', { file: 'csv-query.xlsx', name: 'StudentResults', csv: true });
  await caretAfter(page, 'Sal');
  await page.keyboard.press('F2');
  await expect(page.locator('#status')).toContainText('Queries cannot be renamed here');
  await editor(page).fill('1 + 1');
  await caretAfter(page, '1 + ');
  await page.keyboard.press('F2');
  await expect(page.locator('#status')).toContainText('Put the caret on a step name to rename it.');
});

test('T-WB-20: the palette finds references and definitions too', async ({ page }) => {
  await setup(page, REFS);
  await caretAt(page, REFS.indexOf('Source =') + 2);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('references to the name');
  await page.keyboard.press('Enter');
  await expect(page.locator('.dock-panel[data-panel=references] .ref-row')).toHaveCount(3);
  await caretAfter(page, 'AddColumn(One', 0);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('definition of the name');
  await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toContainText('Went to the step One.');
});
