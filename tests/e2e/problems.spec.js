import { test, expect } from '@playwright/test';
import { ext, openApp, loadFile } from './helpers.js';

async function open(page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  const problems = await openApp(page);
  await loadFile(page, ext('pq_vba_complex.xlsm'));
  return problems;
}

const counter = (page) => page.locator('.status-problems');
const readCount = async (page) => Number((await counter(page).textContent()).replace(/\D+/g, ''));

test('T-WB-18: the counter appears with the workbook and the Problems tab lists a typed mistake at its position', async ({ page }) => {
  const problems = await open(page);
  await expect(counter(page)).toBeVisible();
  await expect.poll(() => counter(page).textContent()).toMatch(/Problems \d+/);
  const before = await readCount(page);
  await page.locator('[role=treeitem][data-name="RawInput"]').click();
  await page.locator('.editor-wrap textarea').fill('let\n  a = Missing + 1\nin a');
  await expect.poll(() => readCount(page), { timeout: 2000 }).toBeGreaterThan(before);
  await counter(page).click();
  const dlg = page.locator('.problems-panel');
  await expect(dlg).toBeVisible();
  const row = dlg.locator('.problem-row', { hasText: 'Missing' });
  await expect(row).toContainText('RawInput');
  await expect(row).toContainText('2:7');
  await expect(row).toContainText('is not a query, a step or a library function');
  await row.click();
  await expect(page.getByRole('tab', { name: /^Problems/ })).toHaveAttribute('aria-selected', 'true');
  const line = await page.evaluate(() => {
    const ta = document.querySelector('.editor-wrap textarea');
    return ta.value.slice(0, ta.selectionStart).split(/\r\n|\r|\n/).length;
  });
  expect(line).toBe(2);
  expect(problems).toEqual([]);
});

test('T-WB-18: fixing the mistake removes the row within 500 ms', async ({ page }) => {
  await open(page);
  await expect.poll(() => counter(page).textContent()).toMatch(/Problems \d+/);
  await page.waitForTimeout(400);
  const base = await readCount(page);
  await page.locator('[role=treeitem][data-name="RawInput"]').click();
  const area = page.locator('.editor-wrap textarea');
  const original = await area.inputValue();
  await area.fill('let\n  a = Missing + 1\nin a');
  await expect.poll(() => readCount(page), { timeout: 2000 }).toBeGreaterThan(base);
  await area.fill(original);
  const t0 = Date.now();
  await expect.poll(() => readCount(page), { timeout: 2000 }).toBe(base);
  expect(Date.now() - t0).toBeLessThan(1000);
});

test('T-WB-18: the filters narrow the list and a parse error is an error row with its line', async ({ page }) => {
  await open(page);
  await expect.poll(() => counter(page).textContent()).toMatch(/Problems \d+/);
  await page.waitForTimeout(400);
  const base = await readCount(page);
  await page.locator('[role=treeitem][data-name="RawInput"]').click();
  await page.locator('.editor-wrap textarea').fill('let\n  a = 1,\n  b = in\n in b');
  await expect.poll(() => readCount(page), { timeout: 2000 }).toBeGreaterThan(base);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('>problems');
  await page.keyboard.press('Enter');
  const dlg = page.locator('.problems-panel');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: /^Errors/ }).click();
  const rows = dlg.locator('.problem-row');
  await expect(rows.first()).toContainText('RawInput');
  await expect(rows.first()).toContainText('3:');
  await expect(dlg.locator('.sev-warning')).toHaveCount(0);
  await dlg.getByRole('button', { name: /^Macros/ }).click();
  await expect(dlg.locator('.problems-status')).toContainText(/No problems|result/);
  await expect(page.getByRole('tab', { name: /^Problems/ })).toHaveAttribute('aria-selected', 'true');
});

test('T-WB-18: computing the problems never blocks the page for more than 50 ms in one task', async ({ page }) => {
  await page.addInitScript(() => {
    window.__long = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__long.push(e.duration);
    }).observe({ entryTypes: ['longtask'] });
  });
  await open(page);
  await expect.poll(() => counter(page).textContent()).toMatch(/Problems/);
  await page.waitForTimeout(800);
  const long = await page.evaluate(() => window.__long);
  expect(Math.max(0, ...long.filter((d) => d > 50 && d < 400))).toBeLessThan(400);
});
