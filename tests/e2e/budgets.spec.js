import { test, expect } from '@playwright/test';
import { openApp, fx } from './helpers.js';

const FACTOR = Number(process.env.QUOIN_PERF_FACTOR || 2);
const record = [];

test.afterAll(() => {
  if (record.length) console.log(`T-WB-27 raw numbers (ms): ${JSON.stringify(Object.fromEntries(record))}`);
});

async function observe(page) {
  await page.addInitScript(() => {
    window.__long = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__long.push({ at: e.startTime, d: e.duration });
    }).observe({ entryTypes: ['longtask'] });
  });
}

const longest = (page, from = 0) => page.evaluate((f) => Math.max(0, ...window.__long.filter((x) => x.at >= f).map((x) => x.d)), from);

async function fixBroken(page) {
  await page.locator('[role=treeitem][data-name="Sales_Broken"]').click();
  await page.locator('.editor-wrap textarea').fill('let\n    Source = Sales_Raw,\n    Bad = Table.SelectRows(Source, each [Amount] > 0)\nin\n    Bad');
  await expect.poll(() => page.locator('.status-problems').textContent()).toBe('Problems 3');
}

async function openMany(page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await observe(page);
  await openApp(page);
  const t0 = await page.evaluate(() => performance.now());
  await page.setInputFiles('input[type=file]', fx('many-queries.xlsx'));
  await page.waitForSelector('[role=treeitem][data-type=query]');
  const interactive = await page.evaluate((t) => performance.now() - t, t0);
  return { t0, interactive };
}

test('T-WB-27: open a 320-query workbook, the problems scan, and selecting a query', async ({ page }) => {
  const { t0, interactive } = await openMany(page);
  record.push(['open', Math.round(interactive)]);
  expect(await page.locator('[role=treeitem][data-type=query]').count()).toBe(320);
  expect(interactive).toBeLessThanOrEqual(1500 * FACTOR);

  await expect.poll(() => page.locator('.status-problems').textContent(), { timeout: 6000 }).toBe('Problems 4');
  const scan = await page.evaluate((t) => performance.now() - t, t0);
  record.push(['problemsScan', Math.round(scan)]);
  expect(scan).toBeLessThanOrEqual(3000 * FACTOR);
  const longTask = await longest(page, t0 + interactive);
  record.push(['longTaskDuringScan', Math.round(longTask)]);
  expect(longTask).toBeLessThanOrEqual(50 * FACTOR);

  const tSel = await page.evaluate(() => performance.now());
  const sel = await page.evaluate(async () => {
    const row = document.querySelector('[role=treeitem][data-name="Sales_Clean"]');
    const t = performance.now();
    row.click();
    for (;;) {
      await new Promise((r) => requestAnimationFrame(r));
      const steps = document.querySelectorAll('.step-row').length;
      const deps = document.querySelector('.deps-panel .deps-col');
      const title = document.querySelector('.item-title');
      if (steps === 7 && deps && title && title.textContent.includes('Sales_Clean')) return performance.now() - t;
      if (performance.now() - t > 2000) return -1;
    }
  });
  record.push(['selectQuery', Math.round(sel)]);
  expect(sel).toBeGreaterThan(0);
  expect(sel).toBeLessThanOrEqual(100 * FACTOR);
  const afterSel = await longest(page, tSel);
  record.push(['longTaskAfterSelect', Math.round(afterSel)]);
  expect(afterSel).toBeLessThanOrEqual(100 * FACTOR);
  record.push(['longTaskAtOpen', Math.round(await longest(page, 0))]);
});

test('T-WB-27: evaluating the steps of a 12-step query costs no more than 1.3 times a plain run', async ({ page }) => {
  await openMany(page);
  await fixBroken(page);
  await page.locator('[role=treeitem][data-name="Wide_Steps"]').click();
  await expect(page.locator('.step-row')).toHaveCount(12);
  const time = async (action, done) => {
    const t = await page.evaluate(() => performance.now());
    await action();
    await page.waitForSelector(done);
    return (await page.evaluate(() => performance.now())) - t;
  };
  const runs = async (n, action, done) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      await page.evaluate(() => document.querySelectorAll('.grid-row').forEach((e) => e.remove()));
      out.push(await time(action, done));
    }
    out.sort((a, b) => a - b);
    return out[Math.floor(out.length / 2)];
  };
  const plain = await runs(5, () => page.getByRole('button', { name: /^Run/ }).first().click(), '.grid-row');
  const steps = await runs(5, () => page.getByRole('button', { name: 'Evaluate steps' }).click(), '.bead-ok');
  record.push(['plainRun', Math.round(plain)], ['evaluateSteps', Math.round(steps)]);
  expect(steps).toBeLessThanOrEqual(plain * 1.3 + 150);
});

test('T-WB-27: a step click with stored results shows the step quickly and the graph of 320 nodes opens', async ({ page }) => {
  await openMany(page);
  await fixBroken(page);
  await page.locator('[role=treeitem][data-name="Wide_Steps"]').click();
  await page.getByRole('button', { name: 'Evaluate steps' }).click();
  await expect(page.locator('.bead-ok')).toHaveCount(12);
  const ms = await page.evaluate(async () => {
    const rows = document.querySelectorAll('.step-row');
    const heads = () => [...document.querySelectorAll('.grid-hcell .hname')].map((e) => e.textContent).join(',');
    const before = heads();
    const t = performance.now();
    rows[4].click();
    for (;;) {
      await new Promise((r) => requestAnimationFrame(r));
      if (heads() !== before) return performance.now() - t;
      if (performance.now() - t > 1000) return -1;
    }
  });
  record.push(['stepCursor', Math.round(ms)]);
  expect(ms).toBeGreaterThan(0);
  expect(ms).toBeLessThanOrEqual(50 * FACTOR);
  const graph = await page.evaluate(async () => {
    const t = performance.now();
    document.querySelector('.deps-panel button').click();
    for (;;) {
      await new Promise((r) => requestAnimationFrame(r));
      if (document.querySelectorAll('.graph-node').length) return performance.now() - t;
      if (performance.now() - t > 3000) return -1;
    }
  });
  record.push(['graphOpen', Math.round(graph)]);
  expect(graph).toBeGreaterThan(0);
  expect(graph).toBeLessThanOrEqual(400 * FACTOR);
});

test('T-WB-27: Run all reports its first member and ends with counts', async ({ page }) => {
  await openMany(page);
  await fixBroken(page);
  await page.waitForTimeout(500);
  const t = await page.evaluate(() => performance.now());
  await page.keyboard.press('Control+Alt+Enter');
  await page.waitForSelector('[role=treeitem] [data-status="ok"]');
  const first = (await page.evaluate(() => performance.now())) - t;
  record.push(['runAllFirstResult', Math.round(first)]);
  expect(first).toBeLessThanOrEqual(500 * FACTOR + 1500);
  await page.locator('dialog[open]').getByRole('button', { name: 'Skip' }).click({ timeout: 30000 });
  await expect(page.locator('.statusbar')).toContainText(/\d+ ran/, { timeout: 60000 });
  const all = (await page.evaluate(() => performance.now())) - t;
  record.push(['runAllTotal', Math.round(all)]);
  await expect(page.locator('.statusbar')).toContainText('failed');
});
