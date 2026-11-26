import { test, expect } from '@playwright/test';
import { ext, openApp, loadFile, item, editor } from './helpers.js';

const QUERY = [
  'let',
  '    Source = #table({"Name", "Age", "City"}, {{"Ann", 30, "Oslo"}, {"Bob", 25, "Rome"}, {"Cy", 30, "Oslo"}, {"Di", 41, "Paris"}, {"Ed", 25, "Rome"}, {"Flo", null, "Oslo"}}),',
  '    Typed = Table.TransformColumnTypes(Source, {{"Age", Int64.Type}})',
  'in',
  '    Typed'
].join('\n');

const resultGrid = (page) => page.locator('.dock-panel[data-panel=result] [role=grid]').first();
const header = (page, name) => page.locator('.dock-panel[data-panel=result] .grid-hcell', { hasText: name }).first();
const chip = (page) => page.locator('.chip.view');

async function setup(page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await loadFile(page, ext('pq_simple.xlsx'));
  await item(page, 'StudentResults').click();
  await editor(page).fill(QUERY);
  await page.getByRole('button', { name: 'Evaluate steps' }).click();
  await expect(page.locator('.bead-ok')).toHaveCount(2);
  await expect(resultGrid(page)).toHaveAttribute('aria-rowcount', '7');
}

async function gridRows(page) {
  return page.locator('.dock-panel[data-panel=result] .grid-row').evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll('.grid-cell:not(.grid-index)')].map((c) => c.textContent)));
}

async function menuItem(page, column, name) {
  await header(page, column).click();
  await page.getByRole('menuitem', { name }).click();
}

async function filterByCondition(page, column, op, value) {
  await menuItem(page, column, 'Filter…');
  const dlg = page.getByRole('dialog', { name: `Filter ${column}` });
  await dlg.getByRole('radio', { name: 'Condition' }).check();
  await dlg.locator('select').selectOption({ label: op });
  if (value !== null) await dlg.getByLabel('Value', { exact: true }).fill(value);
  await dlg.getByRole('button', { name: 'Filter the view' }).click();
  await expect(dlg).toBeHidden();
}

test('T-WB-16: filtering a column from its header shows a view-only chip, leaves the query alone, and Clear restores the result', async ({ page }) => {
  await setup(page);
  const before = await editor(page).inputValue();
  await filterByCondition(page, 'City', 'equals', 'Oslo');
  await expect(chip(page)).toContainText('View only');
  await expect(chip(page)).toContainText('3 of 6 rows');
  await expect(chip(page)).toContainText('1 filter');
  await expect(resultGrid(page)).toHaveAttribute('aria-rowcount', '4');
  expect((await gridRows(page)).map((r) => r[0])).toEqual(['Ann', 'Cy', 'Flo']);
  expect(await editor(page).inputValue()).toBe(before);
  await page.getByRole('button', { name: 'Clear view' }).click();
  await expect(chip(page)).toBeHidden();
  await expect(resultGrid(page)).toHaveAttribute('aria-rowcount', '7');
  expect(await editor(page).inputValue()).toBe(before);
});

test('T-WB-16: a second filter narrows the view, a filter on the same column replaces the first, and numbers compare as numbers', async ({ page }) => {
  await setup(page);
  await filterByCondition(page, 'City', 'equals', 'Oslo');
  await filterByCondition(page, 'Age', 'is greater than', '29');
  await expect(chip(page)).toContainText('2 of 6 rows');
  await expect(chip(page)).toContainText('2 filters');
  expect((await gridRows(page)).map((r) => r[0])).toEqual(['Ann', 'Cy']);
  await filterByCondition(page, 'City', 'equals', 'Rome');
  await expect(chip(page)).toContainText('0 of 6 rows');
  await expect(chip(page)).toContainText('2 filters');
  expect((await gridRows(page)).map((r) => r[0])).toEqual([]);
  await filterByCondition(page, 'Age', 'is null', null);
  await expect(chip(page)).toContainText('2 filters');
  await expect(resultGrid(page)).toHaveAttribute('aria-rowcount', '1');
});

test('T-WB-16: the values list searches, remembers ticks while searching, and filters to the ticked values', async ({ page }) => {
  await setup(page);
  await menuItem(page, 'Name', 'Filter…');
  const dlg = page.getByRole('dialog', { name: 'Filter Name' });
  await expect(dlg.getByRole('checkbox')).toHaveCount(6);
  await dlg.getByLabel('Search values').fill('o');
  await expect(dlg.getByRole('checkbox')).toHaveCount(2);
  await dlg.getByRole('checkbox').first().check();
  await dlg.getByLabel('Search values').fill('');
  await expect(dlg.getByRole('checkbox')).toHaveCount(6);
  await dlg.getByRole('checkbox', { name: /^Di/ }).check();
  await dlg.getByRole('button', { name: 'Filter the view' }).click();
  await expect(chip(page)).toContainText('2 of 6 rows');
  expect((await gridRows(page)).map((r) => r[0])).toEqual(['Bob', 'Di']);
});

test('T-WB-16: applying a values filter with nothing ticked says so and keeps the dialog open', async ({ page }) => {
  await setup(page);
  await menuItem(page, 'City', 'Filter…');
  const dlg = page.getByRole('dialog', { name: 'Filter City' });
  await expect(dlg.getByRole('checkbox')).toHaveCount(3);
  await dlg.getByRole('button', { name: 'Filter the view' }).click();
  await expect(dlg).toContainText('Choose at least one value.');
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await menuItem(page, 'Age', 'Filter…');
  const ages = page.getByRole('dialog', { name: 'Filter Age' });
  await ages.getByRole('radio', { name: 'Condition' }).check();
  await ages.locator('select').selectOption({ label: 'is greater than' });
  await ages.getByLabel('Value', { exact: true }).fill('abc');
  await ages.getByRole('button', { name: 'Filter the view' }).click();
  await expect(ages).toBeVisible();
  await expect(ages).toContainText('Enter a number.');
  await ages.getByRole('button', { name: 'Cancel' }).click();
  await expect(chip(page)).toBeHidden();
});

test('T-WB-16: hiding a column in the view drops it from the grid and the chip counts it', async ({ page }) => {
  await setup(page);
  await menuItem(page, 'Age', 'Hide in view');
  await expect(chip(page)).toContainText('1 column hidden');
  await expect(page.locator('.dock-panel[data-panel=result] .grid-hcell:not(.grid-index)')).toHaveCount(2);
  await expect(header(page, 'Age')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear view' }).click();
  await expect(page.locator('.dock-panel[data-panel=result] .grid-hcell:not(.grid-index)')).toHaveCount(3);
});

test('T-WB-16: the profile of a number column reports fixed figures, and picking a top value filters the view', async ({ page }) => {
  await setup(page);
  await menuItem(page, 'Age', 'Profile column');
  const sheet = page.getByRole('dialog', { name: 'Profile of Age' });
  const stat = (label) => sheet.locator('dt', { hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]');
  await expect(stat('Rows')).toHaveText('6');
  await expect(stat('Null')).toHaveText('1');
  await expect(stat('Errors')).toHaveText('0');
  await expect(stat('Distinct')).toHaveText('3');
  await expect(stat('Minimum')).toHaveText('25');
  await expect(stat('Maximum')).toHaveText('41');
  await expect(stat('Mean')).toHaveText('30.2');
  const top = await sheet.locator('.colwork-top li').evaluateAll((lis) => lis.map((li) => li.textContent));
  expect(top[0]).toContain('30');
  expect(top[0]).toContain('2');
  await sheet.getByRole('button', { name: 'Filter to 25' }).click();
  await expect(sheet).toBeHidden();
  await expect(chip(page)).toContainText('2 of 6 rows');
  expect((await gridRows(page)).map((r) => r[0])).toEqual(['Bob', 'Ed']);
});

test('T-WB-16: the profile of a text column reports its length range and kinds', async ({ page }) => {
  await setup(page);
  await menuItem(page, 'City', 'Profile column');
  const sheet = page.getByRole('dialog', { name: 'Profile of City' });
  await expect(sheet.locator('dt', { hasText: 'Text length' })).toBeVisible();
  await expect(sheet).toContainText('4 to 5 characters');
  await expect(sheet).toContainText('6 text');
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toBeHidden();
});

test('T-WB-16: Add as a step shows the exact M, inserts it after the shown step, reruns, and the new step equals the view', async ({ page }) => {
  await setup(page);
  await filterByCondition(page, 'City', 'equals', 'Oslo');
  await expect(chip(page)).toContainText('3 of 6 rows');
  const viewRows = await gridRows(page);
  expect(viewRows.length).toBe(3);
  await menuItem(page, 'City', 'Add as a step…');
  const dlg = page.getByRole('dialog', { name: 'Add a step for City' });
  await dlg.locator('select').first().selectOption({ label: 'Filter rows' });
  await dlg.locator('select').nth(1).selectOption({ label: 'equals' });
  await dlg.getByLabel('Value', { exact: true }).fill('Oslo');
  await expect(dlg.getByLabel('M for the new step')).toHaveValue('Table.SelectRows(Typed, each [City] = "Oslo")');
  await expect(dlg.getByLabel('Step name')).toHaveValue('Filtered Rows');
  await dlg.getByRole('button', { name: 'Insert step' }).click();
  await expect(dlg).toBeHidden();
  const text = await editor(page).inputValue();
  expect(text).toContain('#"Filtered Rows" = Table.SelectRows(Typed, each [City] = "Oslo")');
  expect(text).toMatch(/in\s+#"Filtered Rows"\s*$/);
  await expect(page.locator('.step-row')).toHaveCount(3);
  await expect(page.locator('.step-row.is-current')).toContainText('Filtered Rows');
  await expect(resultGrid(page)).toHaveAttribute('aria-rowcount', '4');
  await expect(chip(page)).toBeHidden();
  expect(await gridRows(page)).toEqual(viewRows);
});

test('T-WB-16: the generated M can be edited before it is inserted, and a step name that already exists is refused', async ({ page }) => {
  await setup(page);
  await menuItem(page, 'Age', 'Add as a step…');
  const dlg = page.getByRole('dialog', { name: 'Add a step for Age' });
  await dlg.locator('select').first().selectOption({ label: 'Sort descending' });
  await expect(dlg.getByLabel('M for the new step')).toHaveValue('Table.Sort(Typed, {{"Age", Order.Descending}})');
  await dlg.getByLabel('M for the new step').fill('Table.Sort(Typed, {{"Age", Order.Descending}, {"Name", Order.Ascending}})');
  await expect(dlg.getByRole('button', { name: 'Use the generated code' })).toBeVisible();
  await dlg.getByLabel('Step name').fill('Typed');
  await dlg.getByRole('button', { name: 'Insert step' }).click();
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('.colwork-msg')).not.toBeEmpty();
  await dlg.getByLabel('Step name').fill('By Age');
  await dlg.getByRole('button', { name: 'Insert step' }).click();
  await expect(dlg).toBeHidden();
  expect(await editor(page).inputValue()).toContain('#"By Age" = Table.Sort(Typed, {{"Age", Order.Descending}, {"Name", Order.Ascending}})');
  await expect.poll(async () => (await gridRows(page))[0][0]).toBe('Di');
});

test('T-WB-16: rename and change type generate the right M', async ({ page }) => {
  await setup(page);
  await menuItem(page, 'Name', 'Add as a step…');
  const dlg = page.getByRole('dialog', { name: 'Add a step for Name' });
  await dlg.locator('select').first().selectOption({ label: 'Rename this column' });
  await dlg.getByLabel('New name').fill('Student');
  await expect(dlg.getByLabel('M for the new step')).toHaveValue('Table.RenameColumns(Typed, {{"Name", "Student"}})');
  await dlg.locator('select').first().selectOption({ label: 'Change type' });
  await dlg.getByLabel('Type', { exact: true }).selectOption({ label: 'Text' });
  await expect(dlg.getByLabel('M for the new step')).toHaveValue('Table.TransformColumnTypes(Typed, {{"Name", type text}})');
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await expect(dlg).toBeHidden();
});

test('T-WB-16: a result that is not a query step has no Add as a step entry, and the column menu keeps its sort and copy entries', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await loadFile(page, ext('pq_simple.xlsx'));
  await item(page, 'StudentResults').click();
  await editor(page).fill('#table({"A", "B"}, {{2, "x"}, {1, "y"}})');
  await page.getByRole('button', { name: /^Run/ }).first().click();
  await expect(resultGrid(page)).toBeVisible();
  await header(page, 'A').click();
  await expect(page.getByRole('menuitem', { name: 'Sort ascending' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Copy column name' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Filter…' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Add as a step…' })).toHaveCount(0);
});

test('T-WB-16: Enter on a focused column header opens its menu, and Escape closes it and returns focus to the header', async ({ page }) => {
  await setup(page);
  await header(page, 'City').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Profile column' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(header(page, 'City')).toBeFocused();
});

test('T-WB-16: Add as steps turns the view into a filter step and a remove columns step, and the result equals the view', async ({ page }) => {
  await setup(page);
  await filterByCondition(page, 'City', 'equals', 'Oslo');
  await menuItem(page, 'Age', 'Hide in view');
  await expect(chip(page)).toContainText('1 column hidden');
  const viewRows = await gridRows(page);
  expect(viewRows).toEqual([['Ann', 'Oslo'], ['Cy', 'Oslo'], ['Flo', 'Oslo']]);
  await page.getByRole('button', { name: 'Add as steps' }).click();
  const text = await editor(page).inputValue();
  expect(text).toContain('#"Filtered Rows" = Table.SelectRows(Typed, each [City] = "Oslo")');
  expect(text).toContain('#"Removed Columns" = Table.RemoveColumns(#"Filtered Rows", {"Age"})');
  expect(text).toMatch(/in\s+#"Removed Columns"\s*$/);
  await expect(page.locator('.step-row')).toHaveCount(4);
  await expect(page.locator('.step-row.is-current')).toContainText('Removed Columns');
  await expect(chip(page)).toBeHidden();
  await expect(page.getByRole('button', { name: 'Add as steps' })).toBeHidden();
  expect(await gridRows(page)).toEqual(viewRows);
});

test('T-WB-16: Add as steps is not offered for a result that is not a let query', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await loadFile(page, ext('pq_simple.xlsx'));
  await item(page, 'StudentResults').click();
  await editor(page).fill('#table({"A", "B"}, {{2, "x"}, {1, "y"}, {2, "z"}})');
  await page.getByRole('button', { name: /^Run/ }).first().click();
  await expect(resultGrid(page)).toBeVisible();
  await filterByCondition(page, 'A', 'equals', '2');
  await expect(chip(page)).toContainText('2 of 3 rows');
  await expect(page.getByRole('button', { name: 'Clear view' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add as steps' })).toBeHidden();
});
