import { test, expect } from '@playwright/test';
import { fx, openApp, loadFile, item, editor, runButton } from './helpers.js';

async function bigResult(page, n) {
  await openApp(page);
  await loadFile(page, fx('csv-query.xlsx'));
  await item(page, 'StudentResults').click();
  await editor(page).fill(`Table.FromColumns({List.Numbers(1, ${n})}, {"N"})`);
  await runButton(page).click();
  await expect(page.locator('.grid-cell:not(.grid-index)').first()).toHaveText('1', { timeout: 60000 });
}

test('T-B-11: above 200,000 rows sorting is disabled with a reason, and the cell cursor still works', async ({ page }) => {
  test.setTimeout(120000);
  await bigResult(page, 300000);
  await page.locator('.grid-hcell:not(.grid-index)').first().click();
  const asc = page.getByRole('menuitem', { name: 'Sort ascending' });
  await expect(asc).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('.menu')).toContainText('Sorting is available up to 200,000 rows. This result has 300,000.');
  await asc.click({ force: true });
  await expect(page.locator('.menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu')).toHaveCount(0);

  await expect(page.locator('.grid')).toHaveAttribute('aria-rowcount', '300001');
  await expect(page.locator('.grid')).toHaveAttribute('aria-colcount', '2');

  await page.locator('.grid').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.grid-cell.active')).toHaveText('1');
  await page.keyboard.press('Control+End');
  await expect(page.locator('.grid-cell.active')).toHaveText('300000');
  await expect(page.locator('.grid-cell.active')).toHaveAttribute('aria-selected', 'true');
  expect(await page.locator('.grid').evaluate((el) => el.scrollTop)).toBeGreaterThan(8000000);
  await page.keyboard.press('Control+Home');
  await expect(page.locator('.grid-cell.active')).toHaveText('1');
  const before = await page.locator('.grid-cell.active').textContent();
  await page.keyboard.press('PageDown');
  const after = await page.locator('.grid-cell.active').textContent();
  expect(Number(after) - Number(before)).toBeGreaterThan(5);
  await page.keyboard.press('PageUp');
  await expect(page.locator('.grid-cell.active')).toHaveText('1');
});

test('T-B-11: a result at or below the limit still sorts', async ({ page }) => {
  await bigResult(page, 50);
  await page.locator('.grid-hcell:not(.grid-index)').first().click();
  await expect(page.getByRole('menuitem', { name: 'Sort descending' })).not.toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('menuitem', { name: 'Sort descending' }).click();
  await expect(page.locator('.grid-row .grid-cell[role=gridcell]').first()).toHaveText('50');
});

test('T-B-11: Enter on an error cell opens its detail and Escape returns focus to the grid', async ({ page }) => {
  await openApp(page);
  await loadFile(page, fx('csv-query.xlsx'));
  await item(page, 'StudentResults').click();
  await editor(page).fill('Table.TransformColumnTypes(#table({"A"}, {{"1"},{"x"}}), {{"A", type number}})');
  await runButton(page).click();
  await expect(page.locator('.grid-cell.err')).toHaveText('Error');
  await page.locator('.grid').focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('.popover')).toContainText('DataFormat.Error');
  await page.keyboard.press('Escape');
  await expect(page.locator('.popover')).toHaveCount(0);
  await expect(page.locator('.grid-cell.active')).toBeVisible();
});

test('T-B-11: a result taller than any engine allows an element to be still reaches its last row and keeps rows aligned', async ({ page }) => {
  test.setTimeout(90000);
  await openApp(page);
  const rows = 3000000;
  await page.evaluate(async (n) => {
    const { Grid } = await import('/src/ui/grid.js');
    const host = document.createElement('div');
    host.id = 'scale-host';
    host.style.cssText = 'position:fixed;left:0;top:0;width:700px;height:400px;display:flex;flex-direction:column;background:#fff;z-index:9999';
    document.body.append(host);
    const grid = new Grid(host);
    grid.setData({ columns: [{ name: 'N', type: 'number' }], rowCount: n, loader: async (start, count) => Array.from({ length: Math.min(count, n - start) }, (_, k) => [start + k + 1]) });
  }, rows);
  const grid = page.locator('#scale-host .grid');
  await expect(grid.locator('.grid-cell:not(.grid-index)').first()).toHaveText('1');
  expect(await grid.evaluate((el) => el.scrollHeight)).toBeLessThanOrEqual(10000100);

  const viewport = () => grid.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const painted = [...el.querySelectorAll('.grid-row')].map((r) => {
      const b = r.getBoundingClientRect();
      return { index: Number(r.querySelector('.grid-index').textContent), top: b.top - box.top, bottom: b.bottom - box.top };
    }).filter((r) => r.top >= 40 && r.bottom <= el.clientHeight + 1);
    return { height: el.clientHeight, painted };
  });

  await grid.evaluate((el) => { el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) / 2); });
  await expect.poll(async () => (await viewport()).painted.length).toBeGreaterThan(8);
  const middle = await viewport();
  expect(Math.abs(middle.painted[0].index - rows / 2)).toBeLessThan(rows * 0.02);
  for (let i = 1; i < middle.painted.length; i++) {
    expect(middle.painted[i].index).toBe(middle.painted[i - 1].index + 1);
    expect(middle.painted[i].top - middle.painted[i - 1].top).toBeCloseTo(30, 0);
  }

  await grid.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Control+End');
  await expect(grid.locator('.grid-cell.active')).toHaveText('3000000');
  const last = await grid.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const b = el.querySelector('.grid-cell.active').getBoundingClientRect();
    return { top: b.top - box.top, bottom: b.bottom - box.top, height: el.clientHeight };
  });
  expect(last.top).toBeGreaterThanOrEqual(40);
  expect(last.bottom).toBeLessThanOrEqual(last.height + 1);

  await page.keyboard.press('Control+Home');
  await expect(grid.locator('.grid-cell.active')).toHaveText('1');
  expect(await grid.evaluate((el) => el.scrollTop)).toBe(0);
});
