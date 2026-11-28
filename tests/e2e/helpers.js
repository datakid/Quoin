import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect } from '@playwright/test';
import { readZip } from '../../src/core/zip-read.js';
import { parseDataMashup } from '../../src/core/pq/datamashup.js';
import { base64Decode, decodeTextBytes } from '../../src/core/bytes.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const fx = (name) => join(here, '..', 'fixtures', 'workbooks', name);
export const ext = (name) => join(here, '..', 'fixtures', 'external', name);

export async function openApp(page, path = '/index.html') {
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.__problems = problems;
  await page.addInitScript(() => {
    delete window.showSaveFilePicker;
  });
  await page.goto(path);
  await page.waitForSelector('.dropzone');
  return problems;
}

export async function loadFile(page, file) {
  await page.setInputFiles('input[type=file]', file);
  await page.waitForSelector('.workspace, .empty .message');
}

export async function dropFile(page, file, name) {
  const data = readFileSync(file).toString('base64');
  await page.evaluate(({ data, name }) => {
    const bin = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bin], name));
    window.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, cancelable: true }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, cancelable: true }));
  }, { data, name });
  await page.waitForSelector('.workspace, .empty .message');
}

export const item = (page, name) => page.locator(`[role=treeitem][data-name="${name}"]`);
export const editor = (page) => page.locator('.editor-wrap textarea');
export const runButton = (page) => page.getByRole('button', { name: /^Run/ });
export const status = (page) => page.locator('.statusbar');
export const downloadButton = (page) => page.locator('.topbar button[aria-haspopup="dialog"]');

export async function runCurrent(page) {
  await runButton(page).click();
  await page.waitForSelector('.grid-cell, .message', { state: 'attached' });
}

export async function saveDownload(page, clickTarget, path) {
  const [dl] = await Promise.all([page.waitForEvent('download'), clickTarget.click()]);
  await dl.saveAs(path);
  return dl.suggestedFilename();
}

export async function dropTree(page, nodes) {
  await page.evaluate((nodes) => {
    const toEntry = (node, parent) => {
      const fullPath = `${parent}/${node.name}`;
      if (node.children) {
        const kids = node.children.map((c) => toEntry(c, fullPath));
        return {
          isFile: false,
          isDirectory: true,
          name: node.name,
          fullPath,
          createReader() {
            let done = false;
            return {
              readEntries: (ok) => {
                if (done) ok([]);
                else {
                  done = true;
                  ok(kids);
                }
              }
            };
          }
        };
      }
      const bin = Uint8Array.from(atob(node.data), (c) => c.charCodeAt(0));
      return { isFile: true, isDirectory: false, name: node.name, fullPath, file: (ok) => ok(new File([bin], node.name, { lastModified: 1700000000000 })) };
    };
    const entries = nodes.map((n) => toEntry(n, ''));
    const dt = new DataTransfer();
    for (const n of nodes) dt.items.add(new File(n.children ? [] : [Uint8Array.from(atob(n.data), (c) => c.charCodeAt(0))], n.name, { lastModified: 1700000000000 }));
    const carrier = { files: dt.files, items: entries.map((e) => ({ kind: 'file', webkitGetAsEntry: () => e })), types: ['Files'] };
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: carrier });
    window.dispatchEvent(ev);
  }, nodes);
}

export const setSnapshot = (page) =>
  page.evaluate(() => ({
    state: window.__quoin.set.state,
    move: window.__quoin.set.move,
    files: window.__quoin.set.list().map((f) => ({ id: f.id, relPath: f.relPath, name: f.name, size: f.size, status: f.status, badge: f.badge, skipReason: f.skipReason, error: f.error, queries: f.index ? f.index.queries.map((q) => q.name) : null })),
    counts: window.__quoin.set.counts()
  }));

export const waitForSet = async (page, state = 'ready') => {
  try {
    await page.waitForFunction((s) => window.__quoin && window.__quoin.set.state === s, state, { timeout: 45000 });
  } catch (e) {
    const seen = await page.evaluate(() => (window.__quoin ? { state: window.__quoin.set.state, files: window.__quoin.set.list().map((f) => `${f.relPath}:${f.status}`), alert: (document.querySelector('#alert') || {}).textContent || '' } : null)).catch(() => null);
    throw new Error(`${e.message}\nset: ${JSON.stringify(seen)}\npage problems: ${JSON.stringify(page.__problems || [])}`);
  }
};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const byName = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
const MASHUP_ITEM = /^customXml\/item\d+\.xml$/i;
const MASHUP_BODY = /(<(?:[\w.-]+:)?DataMashup\b[^>]*>)([\s\S]*?)(<\/(?:[\w.-]+:)?DataMashup>)/;

async function mashupDigest(bytes) {
  const decoded = decodeTextBytes(bytes);
  const found = MASHUP_BODY.exec(decoded.text);
  if (!found) return null;
  try {
    const model = parseDataMashup(base64Decode(found[2]));
    const parts = [];
    for (const e of model.packageParts.entries) parts.push([e.name, e.isDirectory ? '' : sha256(await e.read())]);
    const open = found.index + found[1].length;
    const firstBreak = found[2].search(/[\r\n]/);
    return sha256(JSON.stringify({
      encoding: decoded.encoding,
      bom: decoded.bom,
      wrapper: `${decoded.text.slice(0, open)}\u0000${decoded.text.slice(open + found[2].length)}`,
      lineLength: firstBreak >= 0 ? firstBreak : 0,
      version: model.version,
      parts: parts.sort(byName),
      permissions: sha256(model.raw.permissions),
      metadata: sha256(model.raw.metadata),
      bindings: sha256(model.permissionBindings)
    }));
  } catch {
    return null;
  }
}

export async function zipDigest(bytes) {
  const zip = readZip(Uint8Array.from(bytes));
  const out = [];
  for (const e of zip.entries) {
    if (e.isDirectory) {
      out.push([e.name, '']);
      continue;
    }
    const data = await e.read();
    const decoded = MASHUP_ITEM.test(e.name) ? await mashupDigest(data) : null;
    out.push([e.name, decoded || sha256(data)]);
  }
  return out.sort(byName);
}

export const skipUnlessChromium = (test, browserName, reason) => test.skip(browserName !== 'chromium', reason);

export const skipOnEngines = (test, browserName, engines, reason) => test.skip(engines.includes(browserName), reason);

export async function expectSameOutput(got, expected, browserName) {
  expect(got.bytesHash).toBe(got.sha256);
  if (browserName === 'chromium') {
    expect(got.sha256).toBe(expected.sha256);
    expect(got.bytesLength).toBe(expected.bytesLength);
    return;
  }
  expect(got.bytes.length).toBeGreaterThan(0);
  expect(await zipDigest(got.bytes)).toEqual(await zipDigest(expected.bytes));
}
