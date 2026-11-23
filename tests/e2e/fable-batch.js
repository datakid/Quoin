import { expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Package } from '../../src/core/opc.js';
import { readZip } from '../../src/core/zip-read.js';
import { openApp, dropTree, waitForSet } from './helpers.js';

export const b64 = (path) => readFileSync(path).toString('base64');
export const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const csvOf = (bytes) => new TextDecoder().decode(bytes.slice(3)).split('\r\n').filter(Boolean).map((l) => l.split(','));

export const NEW_M = 'let\n    Source = 2\nin\n    Source';
export const inject = (spec) => ({ recipe: 'inject', v: 1, inject: { match: 'name', source: 'inline', refreshOnLoad: false, ...spec } });

export const recipeInput = (page) => page.locator('input[aria-label="Recipe file"]');
export const matrix = (page) => page.getByRole('grid', { name: 'Run results' });
export const previewButton = (page) => page.getByRole('button', { name: 'Preview', exact: true });
export const getButton = (page) => page.getByRole('button', { name: 'Get', exact: true });
export const folderButton = (page) => page.getByRole('button', { name: 'Get into a folder' });
export const cancelButton = (page) => page.getByRole('button', { name: 'Cancel' });
export const panel = (page) => page.locator('.recipe-panel');

export const give = (page, json) => recipeInput(page).setInputFiles({ name: 'my.quoin-recipe.json', mimeType: 'application/json', buffer: Buffer.from(typeof json === 'string' ? json : JSON.stringify(json)) });

export async function openSet(page, files, folder = 'books') {
  const problems = await openApp(page);
  await dropTree(page, [{ name: folder, children: files.map(([name, path, data]) => ({ name, data: data || b64(path) })) }]);
  await waitForSet(page);
  return problems;
}

export async function previewed(page, files, recipe) {
  const problems = await openSet(page, files);
  await give(page, recipe);
  await previewButton(page).click();
  await expect(matrix(page)).toBeVisible();
  return problems;
}

export async function zipOf(download) {
  const pkg = new Package(readZip(new Uint8Array(readFileSync(await download.path()))));
  const entries = new Map();
  for (const name of pkg.names()) entries.set(name, await pkg.bytes(name));
  return entries;
}

export const indexOf = (page) => page.evaluate(async () => (await import('/src/app/set-indexes.js')).indexesOf(window.__quoin.set));

export const previewState = (page) => page.evaluate(() => {
  const p = window.__quoin.preview;
  return p ? { rows: p.rows.map((r) => ({ file: r.file, folder: r.folder, unit: r.unit, action: r.action, verdict: r.verdict, code: r.reason_code, reason: r.reason, oldHash: r.old_hash, newHash: r.new_hash })), hashes: [...p.hashes].map(([id, h]) => [p.indexes.find((i) => i.id === id).relPath, h]), counts: p.counts, signedCount: p.signedCount } : null;
});
