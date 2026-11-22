import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openWorkbook } from '../../src/core/workbook.js';
import { buildWorkbook } from '../../src/core/save.js';
import { checkSection } from '../../src/core/m/engine.js';
import { Package } from '../../src/core/opc.js';
import { readZip } from '../../src/core/zip-read.js';
import { fx, openApp, waitForSet, saveDownload } from './helpers.js';

const COUNT = 500;
const original = new Uint8Array(readFileSync(fx('mixed.xlsm')));

async function variant(note) {
  if (!note) return original;
  const wb = await openWorkbook(original, 'mixed.xlsm');
  const q = wb.queries.find((x) => x.name === 'RawInput');
  return (await buildWorkbook(wb, { queryEdits: new Map([['RawInput', `${q.original}\n// ${note}`]]), checkSection })).bytes;
}

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

async function dropGenerated(page) {
  const payloads = [await variant(null), await variant('editA'), await variant('editB')].map((u8) => Buffer.from(u8).toString('base64'));
  await page.evaluate(({ payloads, count }) => {
    const bins = payloads.map((p) => Uint8Array.from(atob(p), (c) => c.charCodeAt(0)));
    const kids = Array.from({ length: count }, (_, i) => {
      const name = `book${String(i).padStart(3, '0')}.xlsm`;
      const bin = bins[i % 10 < 6 ? 0 : i % 10 < 9 ? 1 : 2];
      return { isFile: true, isDirectory: false, name, fullPath: `/many/d${i % 10}/${name}`, file: (ok) => ok(new File([bin], name)) };
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
  }, { payloads, count: COUNT });
}

test('fable scale: 500 generated workbooks are indexed in under a minute, drift is grouped by content hash, and nothing stalls the page', async ({ page }) => {
  test.setTimeout(180000);
  await openApp(page);
  await startLongTaskLog(page);
  const started = Date.now();
  await dropGenerated(page);
  await waitForSet(page);
  expect(Date.now() - started).toBeLessThan(60000);
  await expect(page.locator('.set-file')).toHaveCount(COUNT);
  await expect(page.locator('.set-run-text')).toHaveText(`${COUNT} ready`);
  expect(await longest(page)).toBeLessThan(150);
  await expect(page.locator('.variants-lead')).toHaveText('1 name differs between files.');
  await expect(page.locator('.variant-item').first().locator('.variant-name')).toHaveText('RawInput');
  await expect(page.locator('.variant-item').first().locator('.variant-summary')).toHaveText('500 files, 3 versions');
  await expect(page.locator('.variant-item').nth(1).locator('.variant-summary')).toHaveText('500 files, 1 version');
});

test('fable scale: the filter keeps up with typing across 500 files', async ({ page }) => {
  test.setTimeout(180000);
  await openApp(page);
  await dropGenerated(page);
  await waitForSet(page);
  await startLongTaskLog(page);
  await markNow(page);
  await page.getByRole('searchbox', { name: 'Filter files' }).click();
  await page.keyboard.type('book49', { delay: 20 });
  await expect(page.locator('.set-file')).toHaveCount(10);
  await expect(page.locator('.set-count')).toHaveText(`10 of ${COUNT}`);
  expect(await longest(page)).toBeLessThan(150);
});

test('fable scale: exporting everything from 500 workbooks produces one zip with a folder for each and a report row for each action', async ({ page }, testInfo) => {
  test.setTimeout(240000);
  await openApp(page);
  await dropGenerated(page);
  await waitForSet(page);
  const path = join(testInfo.outputPath('scale'), 'out.zip');
  const started = Date.now();
  await startLongTaskLog(page);
  await markNow(page);
  await saveDownload(page, page.getByRole('button', { name: 'Export everything' }), path);
  expect(Date.now() - started).toBeLessThan(120000);
  expect(await longest(page)).toBeLessThan(250);
  const pkg = new Package(readZip(new Uint8Array(readFileSync(path))));
  const names = pkg.names();
  expect(names.slice(0, 2)).toEqual(['index.xlsx', 'report.csv']);
  const folders = new Set(names.filter((n) => n.includes('/')).map((n) => n.split('/').slice(0, -2).join('/')));
  expect(folders.size).toBe(COUNT);
  expect(names.filter((n) => n.endsWith('RawInput.m'))).toHaveLength(COUNT);
  const csv = new TextDecoder().decode(await pkg.bytes('report.csv')).split('\r\n').filter(Boolean);
  expect(csv.length).toBe(1 + COUNT * 6);
  await expect(page.getByRole('grid', { name: 'Run results' })).toBeVisible();
  expect(await page.evaluate(() => window.__quoin.shell.matrix.grid.rowCount)).toBe(COUNT * 6);
  expect(await page.getByRole('grid', { name: 'Run results' }).locator('.grid-row').count()).toBeLessThan(80);
});
