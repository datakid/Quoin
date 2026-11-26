import { test, expect } from '@playwright/test';
import { openApp, fx } from './helpers.js';

const rows = (page) => page.locator('.nav-list [role=treeitem][data-name]');
const item = (page, name) => page.locator(`.nav-list [role=treeitem][data-name="${name}"]`);
const bead = (page, name) => page.locator(`.nav-list [role=treeitem][data-name="${name}"] .dot-loaded, .nav-list [role=treeitem][data-name="${name}"] .dot-conn`);

async function openMany(page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await page.setInputFiles('input[type=file]', fx('many-queries.xlsx'));
  await page.waitForSelector('.nav-list [role=treeitem][data-type=query]');
}

const toTop = (page) => page.locator('.rail').evaluate((el) => {
  el.scrollTop = 0;
});

async function edit(page, name, text) {
  await toTop(page);
  await item(page, name).click();
  await page.locator('.editor-wrap textarea').fill(text);
}

async function fixBroken(page) {
  await item(page, 'Sales_Broken').click();
  await page.locator('.editor-wrap textarea').fill('let\n    Source = Sales_Raw,\n    Bad = Table.SelectRows(Source, each [Amount] > 0)\nin\n    Bad');
  await expect.poll(() => page.locator('.status-problems').textContent()).toBe('Problems 3');
}

test('T-WB-11: fuzzy search finds Sales_Clean first for sclean', async ({ page }) => {
  await openMany(page);
  await page.getByRole('searchbox', { name: 'Search queries' }).fill('sclean');
  await expect(rows(page).first()).toHaveAttribute('data-name', 'Sales_Clean');
  await expect(rows(page).first().locator('mark.hit').first()).toBeVisible();
  await page.getByRole('searchbox').fill('');
  await expect(rows(page).first()).toHaveAttribute('data-name', 'StudentResults');
  await expect(rows(page).nth(1)).toHaveAttribute('data-name', 'Staging_01');
});

test('T-WB-11: code: counts matches inside the code and Enter opens the first match', async ({ page }) => {
  await openMany(page);
  const search = page.getByRole('searchbox');
  await search.fill('code:Table.Group');
  await expect(rows(page)).toHaveCount(2);
  const names = await rows(page).evaluateAll((els) => els.map((e) => e.dataset.name).sort());
  expect(names).toEqual(['Sales_Summary', 'Sales_by_Region']);
  await expect(rows(page).first().locator('.tree-meta')).toHaveText('1 match');
  await search.press('Enter');
  await expect(page.locator('.item-title')).toHaveText(/Sales_(Summary|by_Region)/);
  const caret = await page.locator('.editor-wrap textarea').evaluate((t) => t.selectionStart);
  expect(caret).toBe(0);
});

test('T-WB-11: step: finds queries that have a step of that name', async ({ page }) => {
  await openMany(page);
  await page.getByRole('searchbox').fill('step:Changed Type');
  const names = await rows(page).evaluateAll((els) => els.map((e) => e.dataset.name));
  expect(names).toContain('Sales_Clean');
  expect(names).not.toContain('Sales_Raw');
  expect(names).not.toContain('Wide_Steps');
});

test('T-WB-11: group by layer gives Sources, Staging and Outputs with counts, and a group collapses', async ({ page }) => {
  await openMany(page);
  await page.getByLabel('Group by').selectOption('layer');
  const heads = page.locator('.nav-list [role=treeitem][data-group]');
  await expect(heads.first()).toContainText('Sources');
  await expect(heads.first()).toHaveAttribute('aria-expanded', 'true');
  await expect(heads.first()).toHaveAttribute('aria-level', '1');
  await expect(heads.first()).toHaveAttribute('aria-posinset', '1');
  await expect(heads.first()).toHaveAttribute('aria-setsize', '3');
  await expect(rows(page).first()).toHaveAttribute('aria-level', '2');
  await expect(heads.nth(1)).toContainText('Staging');
  await heads.first().click();
  await expect(heads.first()).toHaveAttribute('aria-expanded', 'false');
  await expect(heads.nth(1)).toBeVisible();
  await heads.nth(1).click();
  await expect(heads.nth(2)).toContainText('Outputs');
  await expect(heads.nth(2)).toHaveAttribute('aria-posinset', '3');
  await expect(heads.nth(2)).toHaveAttribute('aria-expanded', 'true');
  await heads.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(heads.first()).toHaveAttribute('aria-expanded', 'true');
  await expect(item(page, 'From_Sql')).toHaveCount(1);
});

test('T-WB-11: chips filter, combine and show their counts; more chips appear once active', async ({ page }) => {
  await openMany(page);
  const fn = page.locator('.nav-chip[data-chip=functions]');
  await expect(fn).toBeHidden();
  await page.getByRole('button', { name: 'More filters' }).click();
  await page.getByRole('checkbox', { name: /Functions/ }).check();
  await page.keyboard.press('Escape');
  await expect(fn).toBeVisible();
  await expect(fn).toHaveAttribute('aria-pressed', 'true');
  await expect(fn.locator('.nav-chip-n')).toHaveText('7');
  const names = await rows(page).evaluateAll((els) => els.map((e) => e.dataset.name));
  expect(names).toHaveLength(7);
  expect(names.every((n) => /^fx_/.test(n))).toBe(true);
  await page.locator('.nav-chip[data-chip=edited]').click();
  await expect(page.locator('.nav-list [role=treeitem][data-name]')).toHaveCount(0);
  await expect(page.locator('.nav-list')).toContainText('No queries match.');
  await page.locator('.nav-chip[data-chip=edited]').click();
  await fn.click();
  await expect(rows(page).first()).toHaveAttribute('data-name', 'StudentResults');
});

test('T-WB-11: the edited chip lists edited queries and the count follows the edit', async ({ page }) => {
  await openMany(page);
  await edit(page, 'Staging_03', 'Table.FirstN(Staging_02, 3)');
  const chip = page.locator('.nav-chip[data-chip=edited]');
  await expect(chip.locator('.nav-chip-n')).toHaveText('1');
  await chip.click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toHaveAttribute('data-name', 'Staging_03');
  await expect(rows(page).first().locator('.dot-edited')).toHaveCount(1);
});

test('T-WB-11: five selected queries run, and exactly those five get results', async ({ page }) => {
  await openMany(page);
  await fixBroken(page);
  await toTop(page);
  await item(page, 'Staging_01').click();
  await item(page, 'Staging_05').click({ modifiers: ['Shift'] });
  const bar = page.getByRole('toolbar', { name: 'Selection' });
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('5 selected');
  await expect(page.locator('.nav-list [aria-selected=true]')).toHaveCount(5);
  await bar.getByRole('button', { name: 'Selection: run', exact: true }).click();
  await expect(bead(page, 'Staging_05')).toHaveAttribute('data-status', 'ok', { timeout: 15000 });
  for (const n of ['01', '02', '03', '04', '05']) await expect(bead(page, `Staging_${n}`)).toHaveAttribute('data-status', 'ok');
  const ok = await page.locator('.nav-list [data-status=ok]').count();
  expect(ok).toBe(5);
  await toTop(page);
  await expect(bead(page, 'Staging_06')).toHaveAttribute('data-status', 'never');
});

test('T-WB-11: Run with downstream adds the queries that depend on the selection', async ({ page }) => {
  await openMany(page);
  await fixBroken(page);
  await toTop(page);
  await item(page, 'Sales_Raw').click();
  await item(page, 'Sales_Clean').click({ modifiers: ['Control'] });
  const bar = page.getByRole('toolbar', { name: 'Selection' });
  await bar.getByRole('button', { name: 'Selection: run with downstream' }).click();
  await expect(bead(page, 'Sales_Report')).toHaveAttribute('data-status', 'ok', { timeout: 15000 });
  for (const n of ['Sales_Raw', 'Sales_Clean', 'Sales_Returns', 'Sales_Summary', 'Sales_by_Region', 'Sales_Forecast', 'Sales_Report', 'Sales_Broken']) await expect(bead(page, n)).toHaveAttribute('data-status', 'ok');
  await toTop(page);
  await expect(bead(page, 'Staging_01')).toHaveAttribute('data-status', 'never');
});

test('T-WB-11: the list is virtualised, positions are real, and the last row is reachable', async ({ page }) => {
  await openMany(page);
  const total = await page.locator('.nav-list [role=treeitem]').count();
  expect(total).toBeLessThan(80);
  await expect(rows(page).first()).toHaveAttribute('aria-posinset', '1');
  await expect(rows(page).first()).toHaveAttribute('aria-setsize', '320');
  await expect(rows(page).nth(1)).toHaveAttribute('aria-posinset', '2');
  await expect(page.locator('.nav-list')).toHaveAttribute('role', 'tree');
  await expect(page.locator('.nav-list')).toHaveAttribute('aria-multiselectable', 'true');
  await page.locator('.rail').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(rows(page).last()).toHaveAttribute('aria-posinset', '320');
  await expect(rows(page).last()).toHaveAttribute('aria-setsize', '320');
  const after = await page.locator('.nav-list [role=treeitem]').count();
  expect(after).toBeLessThan(80);
});

test('T-WB-11: keyboard selection: Space toggles, Shift+Arrow extends, Ctrl+A selects all visible, Escape clears', async ({ page }) => {
  await openMany(page);
  await page.getByRole('searchbox').fill('Staging_0');
  await expect(rows(page)).toHaveCount(10);
  await page.getByRole('searchbox').press('ArrowDown');
  await expect(page.locator('.nav-list [role=treeitem]:focus')).toHaveCount(1);
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(page.locator('.nav-list [aria-selected=true]')).toHaveCount(3);
  await expect(page.getByRole('toolbar', { name: 'Selection' })).toContainText('3 selected');
  await page.keyboard.press('Escape');
  await expect(page.locator('.nav-list [aria-selected=true]')).toHaveCount(0);
  await expect(page.getByRole('toolbar', { name: 'Selection' })).toBeHidden();
  await page.keyboard.press('Control+a');
  await expect(page.locator('.nav-list [aria-selected=true]')).toHaveCount(10);
  await page.keyboard.press('Escape');
  await expect(page.locator('.nav-list [aria-selected=true]')).toHaveCount(0);
  await page.keyboard.press(' ');
  await page.keyboard.press('Control+ArrowDown');
  await page.keyboard.press('Control+ArrowDown');
  await page.keyboard.press(' ');
  await expect(page.locator('.nav-list [aria-selected=true]')).toHaveCount(2);
  await expect(page.getByRole('toolbar', { name: 'Selection' })).toContainText('2 selected');
});

test('T-WB-11: copy names puts the selected names on the clipboard in list order', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openMany(page);
  await item(page, 'Staging_02').click();
  await item(page, 'Staging_04').click({ modifiers: ['Control'] });
  await page.getByRole('toolbar', { name: 'Selection' }).getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Copy names' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('Staging_02\nStaging_04');
});

test('T-WB-11: the row menu reverts the selected edited queries', async ({ page }) => {
  await openMany(page);
  await edit(page, 'Staging_03', 'Table.FirstN(Staging_02, 3)');
  await expect(item(page, 'Staging_03').locator('.dot-edited')).toHaveCount(1);
  await item(page, 'Staging_03').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Revert' }).click();
  await expect(item(page, 'Staging_03').locator('.dot-edited')).toHaveCount(0);
});

test('T-WB-11: sort by name orders the list and the sort is off while searching', async ({ page }) => {
  await openMany(page);
  await page.getByLabel('Sort by').selectOption('name');
  const names = await rows(page).evaluateAll((els) => els.slice(0, 5).map((e) => e.dataset.name));
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  expect(names).toEqual(sorted);
  await page.getByRole('searchbox').fill('sales');
  await expect(page.getByLabel('Sort by')).toBeDisabled();
});

test('T-WB-11: the palette offers the five selection actions on the current selection', async ({ page }) => {
  await openMany(page);
  await item(page, 'Staging_05').click();
  await item(page, 'Sales_Clean').click({ modifiers: ['Control'] });
  await expect(page.locator('.nav-list [aria-selected=true]')).toHaveCount(2);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('>selected');
  const row = (name) => page.locator('.palette-row').filter({ hasText: new RegExp(`^${name}($|Select)`) });
  for (const name of ['Run the selected queries', 'Run the selected queries with downstream', 'Revert the selected items', 'Show the first selected query in the graph', 'Copy the selected names']) {
    await expect(row(name)).toBeVisible();
  }
  for (const name of ['Run the selected queries', 'Run the selected queries with downstream', 'Show the first selected query in the graph', 'Copy the selected names']) {
    await expect(row(name)).not.toHaveAttribute('aria-disabled', 'true');
  }
  await expect(row('Revert the selected items')).toHaveAttribute('aria-disabled', 'true');
  await row('Copy the selected names').click();
  await expect(page.locator('.statusbar')).toContainText('Copied 2 names.');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('show the first selected query in the graph');
  await page.locator('.palette-row').filter({ hasText: /^Show the first selected query in the graph$/ }).click();
  await expect(page.locator('.graph-panel')).toBeVisible();
});
