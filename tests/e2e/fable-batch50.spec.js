import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ext, fx, openApp, dropTree, waitForSet } from './helpers.js';
import { give, previewButton, getButton, matrix, zipOf, sha, previewState, panel, b64 } from './fable-batch.js';
import { Package } from '../../src/core/opc.js';
import { readZip } from '../../src/core/zip-read.js';
import { indexWorkbook } from '../../src/batch/index/file-index.js';

const replaceCode = { recipe: 'replace', v: 1, replace: { in: ['m', 'vba'], find: 'DateTime', with: 'MyDateTime', kind: 'text', matchCase: true } };

const sources = { pq: ext('pq_simple.xlsx'), vba: fx('mixed.xlsm') };
const folders = ['east', 'west', 'north', 'south', 'centre'];
const files = Array.from({ length: 50 }, (_, i) => {
  const kind = i % 2 === 0 ? 'pq' : 'vba';
  const folder = folders[i % folders.length];
  return { kind, folder, name: `${kind}${String(i).padStart(2, '0')}.${kind === 'pq' ? 'xlsx' : 'xlsm'}`, path: `books/${folder}/${kind}${String(i).padStart(2, '0')}.${kind === 'pq' ? 'xlsx' : 'xlsm'}` };
});

const partsOf = async (bytes) => {
  const pkg = new Package(readZip(new Uint8Array(bytes)));
  const parts = new Map();
  for (const name of pkg.names()) parts.set(name, await pkg.bytes(name));
  return parts;
};

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

test('fable batch of 50: every output differs from its input only in the declared parts and carries exactly the units the preview named', async ({ page }) => {
  test.setTimeout(180000);
  const problems = await openApp(page);
  const byFolder = folders.map((name) => ({ name, children: files.filter((f) => f.folder === name).map((f) => ({ name: f.name, data: b64(sources[f.kind]) })) }));
  await dropTree(page, [{ name: 'books', children: byFolder }]);
  await waitForSet(page);
  expect(await page.evaluate(() => window.__quoin.set.counts().ready)).toBe(50);

  await give(page, replaceCode);
  await previewButton(page).click();
  await expect(matrix(page)).toBeVisible({ timeout: 120000 });
  const plan = await previewState(page);
  expect(plan.counts.failed).toBe(0);
  expect(plan.counts.refused).toBe(0);
  expect([...new Set(plan.rows.filter((r) => r.verdict === 'changed').map((r) => `${r.folder}${r.file}`))].sort()).toEqual(files.map((f) => f.path).sort());
  expect(plan.signedCount).toBe(0);

  await page.waitForTimeout(1100);
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), getButton(page).click()]);
  const entries = await zipOf(download);
  expect([...entries.keys()].filter((k) => k !== 'report.csv').sort()).toEqual(files.map((f) => f.path).sort());
  expect(plan.hashes.length).toBe(50);
  for (const [path, hash] of plan.hashes) expect(sha(entries.get(path)), path).toBe(hash);

  const originals = { pq: await partsOf(readFileSync(sources.pq)), vba: await partsOf(readFileSync(sources.vba)) };
  const baseIndex = {};
  for (const kind of ['pq', 'vba']) {
    const name = kind === 'pq' ? 'base.xlsx' : 'base.xlsm';
    const bytes = new Uint8Array(readFileSync(sources[kind]));
    baseIndex[kind] = await indexWorkbook(bytes, { id: 'b', name, relPath: name, size: bytes.length });
    expect(baseIndex[kind].status).toBe('ready');
    expect(baseIndex[kind].queries.length).toBeGreaterThan(0);
  }
  const touched = { pq: new Set(), vba: new Set() };

  for (const f of files) {
    const out = await partsOf(entries.get(f.path));
    const was = originals[f.kind];
    expect([...out.keys()].sort(), f.path).toEqual([...was.keys()].sort());
    for (const [name, data] of out) if (!same(data, was.get(name))) touched[f.kind].add(name);
    const after = await indexWorkbook(entries.get(f.path), { id: 'x', name: f.name, relPath: f.path, size: entries.get(f.path).length });
    expect(after.status, f.path).toBe('ready');
    const rows = plan.rows.filter((r) => `${r.folder}${r.file}` === f.path && r.verdict === 'changed');
    const next = new Map(rows.map((r) => [r.oldHash, r.newHash]));
    const units = [...baseIndex[f.kind].queries, ...baseIndex[f.kind].modules];
    const expectedHashes = units.map((u) => next.get(u.hash) || u.hash);
    expect([...after.queries, ...after.modules].map((u) => u.hash), f.path).toEqual(expectedHashes);
  }

  expect([...touched.pq].every((n) => n.startsWith('customXml/'))).toBe(true);
  expect(touched.pq.size).toBe(1);
  expect(touched.vba.size).toBe(1);
  expect([...touched.vba].every((n) => n.startsWith('customXml/'))).toBe(true);
  expect([...touched.vba].includes('xl/vbaProject.bin')).toBe(false);
  await expect(panel(page).locator('.recipe-notes')).toContainText('Downloaded Replace');
  expect(problems).toEqual([]);
});

test('fable batch of 50: replacing a module in fifty macro workbooks touches the macro project and nothing else', async ({ page }) => {
  test.setTimeout(180000);
  await openApp(page);
  const names = Array.from({ length: 50 }, (_, i) => `m${String(i).padStart(2, '0')}.xlsm`);
  const byFolder = folders.map((name, k) => ({ name, children: names.filter((_, i) => i % folders.length === k).map((n) => ({ name: n, data: b64(sources.vba) })) }));
  await dropTree(page, [{ name: 'books', children: byFolder }]);
  await waitForSet(page);
  await give(page, { recipe: 'inject', v: 1, inject: { target: 'module', op: 'replace', match: 'name', name: 'Module1', source: 'inline', text: 'Sub A()\r\nEnd Sub\r\n', refreshOnLoad: false } });
  await previewButton(page).click();
  await expect(matrix(page)).toBeVisible({ timeout: 120000 });
  const plan = await previewState(page);
  expect(plan.counts.changed).toBe(50);
  await page.waitForTimeout(1100);
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), getButton(page).click()]);
  const entries = await zipOf(download);
  expect(plan.hashes.length).toBe(50);
  for (const [path, hash] of plan.hashes) expect(sha(entries.get(path)), path).toBe(hash);
  const was = await partsOf(readFileSync(sources.vba));
  const touched = new Set();
  for (const [path] of plan.hashes) {
    const out = await partsOf(entries.get(path));
    expect([...out.keys()].sort(), path).toEqual([...was.keys()].sort());
    for (const [name, data] of out) if (!same(data, was.get(name))) touched.add(name);
  }
  expect([...touched]).toEqual(['xl/vbaProject.bin']);
});
