import { test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { fx, openApp } from './helpers.js';
import { inject, NEW_M, give, previewButton, getButton, matrix } from './fable-batch.js';

test.skip(!process.env.QUOIN_PERF, 'measurement, run with QUOIN_PERF=1');

const original = Buffer.from(readFileSync(fx('mixed.xlsm'))).toString('base64');

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

const heapOf = async (cdp) => {
  for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage');
  const usage = await cdp.send('Runtime.getHeapUsage');
  return Math.round((usage.usedSize + usage.backingStorageSize) / 1048576 * 10) / 10;
};

async function dropGenerated(page, count) {
  await page.evaluate(({ payload, count }) => {
    const bin = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    const kids = Array.from({ length: count }, (_, i) => {
      const name = `book${String(i).padStart(4, '0')}.xlsm`;
      return { isFile: true, isDirectory: false, name, fullPath: `/many/d${i % 20}/${name}`, file: (ok) => ok(new File([bin], name)) };
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
  }, { payload: original, count });
}

const report = (label, data) => console.log(`PERF ${label} ${JSON.stringify(data)}`);

for (const count of [500, 2000]) {
  test(`perf: index ${count} workbooks, filter, then Preview and Get an Inject`, async ({ page }) => {
    test.setTimeout(1200000);
    await openApp(page);
    const cdp = await page.context().newCDPSession(page);
    const env = await page.evaluate(async () => ({ cores: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory || null, pool: (await import('/src/app/pool.js')).sharedPool().stats() }));
    report('env', { ...env, cpu: os.cpus()[0].model, nodeCores: os.cpus().length, browser: page.context().browser().version() });
    await startLongTaskLog(page);

    const t0 = Date.now();
    await dropGenerated(page, count);
    await page.waitForFunction(() => window.__quoin && window.__quoin.set.state === 'ready', null, { timeout: 1200000 });
    const indexMs = Date.now() - t0;
    const indexLongest = await longest(page);
    const indexHeap = await heapOf(cdp);
    report('index', { count, indexMs, filesPerSecond: Math.round(count / (indexMs / 1000) * 10) / 10, longestTaskMs: indexLongest, heapMiB: indexHeap, pool: (await page.evaluate(async () => (await import('/src/app/pool.js')).sharedPool().stats())) });

    await markNow(page);
    await page.getByRole('searchbox', { name: 'Filter files' }).click();
    await page.keyboard.type(`book${String(count - 1).slice(0, 3)}`, { delay: 20 });
    await page.waitForTimeout(300);
    report('filter', { count, longestTaskMs: await longest(page) });

    await give(page, inject({ target: 'query', op: 'add', name: 'Added', text: NEW_M }));
    await markNow(page);
    const p0 = Date.now();
    await previewButton(page).click();
    await matrix(page).waitFor({ timeout: 1200000 });
    const previewMs = Date.now() - p0;
    const previewLongest = await longest(page);
    report('preview', { count, previewMs, filesPerSecond: Math.round(count / (previewMs / 1000) * 10) / 10, longestTaskMs: previewLongest, heapMiB: await heapOf(cdp) });

    await markNow(page);
    const g0 = Date.now();
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 1200000 }), getButton(page).click()]);
    const zipPath = await download.path();
    const getMs = Date.now() - g0;
    report('get', { count, getMs, filesPerSecond: Math.round(count / (getMs / 1000) * 10) / 10, longestTaskMs: await longest(page), zipMiB: Math.round(readFileSync(zipPath).length / 1048576 * 10) / 10, heapMiB: await heapOf(cdp) });
  });
}
