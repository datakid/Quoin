import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ext, openApp, waitForSet } from './helpers.js';

const COUNT = 200;

async function startLongTaskLog(page) {
  await page.evaluate(() => {
    window.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__longTasks.push([e.startTime, Math.round(e.duration)]);
    }).observe({ type: 'longtask', buffered: true });
  });
}

const markNow = (page) => page.evaluate(() => (window.__mark = performance.now()));

const longest = (page) => page.evaluate(() => Math.max(0, ...window.__longTasks.filter(([at]) => at >= window.__mark).map(([, d]) => d)));

async function dropGenerated(page, count) {
  const data = readFileSync(ext('pq_simple.xlsx')).toString('base64');
  await page.evaluate(({ data, count }) => {
    const bin = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const kids = Array.from({ length: count }, (_, i) => {
      const name = `book${String(i).padStart(3, '0')}.xlsx`;
      return { isFile: true, isDirectory: false, name, fullPath: `/many/${name}`, file: (ok) => ok(new File([bin], name)) };
    });
    const dir = {
      isFile: false,
      isDirectory: true,
      name: 'many',
      fullPath: '/many',
      createReader() {
        let done = false;
        return { readEntries: (ok) => (done ? ok([]) : ((done = true), ok(kids))) };
      }
    };
    window.__mark = performance.now();
    const dt = new DataTransfer();
    dt.items.add(new File([], 'many'));
    const carrier = { files: dt.files, items: [{ kind: 'file', webkitGetAsEntry: () => dir }], types: ['Files'] };
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: carrier });
    window.dispatchEvent(ev);
  }, { data, count });
}

test('fable responsive: indexing 200 generated files leaves no main-thread task over 100 ms', async ({ page }) => {
  await openApp(page);
  await startLongTaskLog(page);
  const started = Date.now();
  await dropGenerated(page, COUNT);
  await waitForSet(page);
  expect(Date.now() - started).toBeLessThan(60000);
  await expect(page.locator('.set-file')).toHaveCount(COUNT);
  await expect(page.locator('.set-run-text')).toHaveText(`${COUNT} ready`);
  expect(await longest(page)).toBeLessThan(100);
});

test('fable responsive: the filter keeps up with typing in a set of 200 files', async ({ page }) => {
  await openApp(page);
  await dropGenerated(page, COUNT);
  await waitForSet(page);
  await startLongTaskLog(page);
  await markNow(page);
  const filter = page.getByRole('searchbox', { name: 'Filter files' });
  await filter.click();
  await page.keyboard.type('book15', { delay: 20 });
  await expect(page.locator('.set-file')).toHaveCount(10);
  await expect(page.locator('.set-count')).toHaveText(`10 of ${COUNT}`);
  const typed = await page.evaluate(async () => {
    const input = document.querySelector('.set-filter');
    const times = [];
    for (const q of ['b', 'bo', 'boo', 'book', 'book0', 'book00', 'book001']) {
      const t0 = performance.now();
      input.value = q;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      times.push(Math.round(performance.now() - t0));
    }
    return times;
  });
  expect(Math.max(...typed)).toBeLessThan(100);
  expect(await longest(page)).toBeLessThan(100);
  await expect(page.locator('.set-file')).toHaveCount(1);
});
