import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ext, fx, openApp, dropTree, waitForSet } from './helpers.js';

const b64 = (path) => readFileSync(path).toString('base64');

test('fable read-only: exporting everything calls no write API and leaves every source file as it was', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    window.__writes = [];
    for (const name of ['showSaveFilePicker', 'showDirectoryPicker', 'showOpenFilePicker']) {
      const original = window[name];
      window[name] = (...args) => {
        window.__writes.push(name);
        return original ? original.apply(window, args) : Promise.reject(new Error('unavailable'));
      };
    }
    for (const proto of [window.FileSystemFileHandle && FileSystemFileHandle.prototype, window.FileSystemWritableFileStream && FileSystemWritableFileStream.prototype]) {
      if (!proto) continue;
      for (const method of ['createWritable', 'write', 'truncate', 'close']) {
        const original = proto[method];
        if (typeof original !== 'function') continue;
        proto[method] = function (...args) {
          window.__writes.push(method);
          return original.apply(this, args);
        };
      }
    }
  });
  await dropTree(page, [{ name: 'books', children: [{ name: 'mixed.xlsm', data: b64(fx('mixed.xlsm')) }, { name: 'pq_simple.xlsx', data: b64(ext('pq_simple.xlsx')) }, { name: 'signed.xlsm', data: b64(fx('signed.xlsm')) }] }]);
  await waitForSet(page);
  const digest = () =>
    page.evaluate(async () => {
      const out = [];
      for (const f of window.__quoin.set.list()) {
        const bytes = new Uint8Array(await f.file.arrayBuffer());
        const hash = await crypto.subtle.digest('SHA-256', bytes);
        out.push([f.relPath, f.file.size, f.file.lastModified, Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')]);
      }
      return out;
    });
  const before = await digest();
  expect(before).toHaveLength(3);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export everything' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^Collect /);
  await page.waitForFunction(() => window.__quoin.set.state === 'done');
  expect(await page.evaluate(() => window.__writes)).toEqual([]);
  expect(await digest()).toEqual(before);
});
