import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { rowDiff } from '../../src/app/row-diff.js';
import { reportRows } from '../../src/app/outputs.js';
import { indexWorkbook } from '../../src/batch/index/file-index.js';
import { resolvePlan } from '../../src/batch/resolve/resolve.js';
import { parseRecipe } from '../../src/batch/recipe/recipe.js';
import { runFilePlan } from '../../src/batch/execute/run-file.js';

const NOW = '2026-11-14T10:00:00.000Z';
const WB = new URL('../fixtures/workbooks/', import.meta.url);
const EXT = new URL('../fixtures/external/', import.meta.url);
const read = (dir, name) => new Uint8Array(fs.readFileSync(new URL(name, dir)));
const NEW_M = 'let\n    Source = 2\nin\n    Source';

const injectReplace = { recipe: 'inject', v: 1, inject: { target: 'query', op: 'replace', match: 'name', name: 'StudentResults', source: 'inline', text: NEW_M, refreshOnLoad: false } };
const replaceCode = { recipe: 'replace', v: 1, replace: { in: ['m', 'vba'], find: 'DateTime', with: 'MyDateTime', kind: 'text', matchCase: true } };

async function previewOf(specs, json, includeTexts = true) {
  const recipe = parseRecipe(JSON.stringify(json)).recipe;
  const indexes = [];
  const sources = new Map();
  let n = 0;
  for (const [dir, name, relPath] of specs) {
    const bytes = read(dir, name);
    const meta = { id: `f${String(++n).padStart(4, '0')}`, name: relPath.split('/').pop(), relPath, size: bytes.length };
    indexes.push(await indexWorkbook(bytes, meta));
    sources.set(meta.id, { bytes, meta });
  }
  const plan = resolvePlan(recipe, indexes, { now: NOW });
  const perFile = new Map();
  for (const fp of plan.files) {
    if (!fp.units.length) continue;
    const { bytes, meta } = sources.get(fp.fileId);
    const res = await runFilePlan(bytes, meta, fp, { now: NOW, dryRun: true, limits: recipe.more.limits, culture: recipe.more.culture, runId: 'r1', recipe, acknowledgeSignature: true, includeTexts });
    perFile.set(fp.fileId, { rows: res.rows, changes: res.changes });
  }
  const rows = reportRows(plan, indexes, new Map([...perFile].map(([id, v]) => [id, { rows: v.rows }])), 'r1');
  return { indexes, perFile, rows };
}

test('a changed row gives the file, the target, the action and the text before and after', async () => {
  const p = await previewOf([[EXT, 'pq_simple.xlsx', 'east/pq_simple.xlsx']], injectReplace);
  const d = rowDiff(p, 0);
  assert.equal(d.file, 'east/pq_simple.xlsx');
  assert.deepEqual(d.target, { type: 'query', name: 'StudentResults' });
  assert.equal(d.op, 'replace');
  assert.equal(d.after, NEW_M);
  assert.ok(d.before.length > 0 && d.before !== d.after);
});

test('each row of a replace in code gets its own target, and rows that did not change have no diff', async () => {
  const p = await previewOf([[WB, 'mixed.xlsm', 'north/mixed.xlsm']], replaceCode);
  const diffs = p.rows.map((_, i) => rowDiff(p, i));
  const changed = p.rows.map((r, i) => [r.verdict, diffs[i]]);
  assert.ok(changed.some(([v]) => v === 'changed'));
  for (const [verdict, d] of changed) {
    if (verdict === 'changed') {
      assert.equal(d.op, 'replaceText');
      assert.ok(d.before.includes('DateTime'));
      assert.equal(d.after, d.before.split('DateTime').join('MyDateTime'));
    } else assert.equal(d, null);
  }
});

test('rows from different files with the same text each get their own file', async () => {
  const p = await previewOf([[EXT, 'pq_simple.xlsx', 'east/pq_simple.xlsx'], [EXT, 'pq_simple.xlsx', 'west/pq_simple.xlsx']], injectReplace);
  assert.deepEqual([0, 1].map((i) => rowDiff(p, i).file), ['east/pq_simple.xlsx', 'west/pq_simple.xlsx']);
});

test('two changes in one file with identical hashes are told apart by their order', () => {
  const change = (name) => ({ op: 'replace', target: { type: 'query', name }, oldHash: 'a', newHash: 'b', texts: { before: `old ${name}`, after: `new ${name}` } });
  const row = { folder: '', file: 'x.xlsx', verdict: 'changed', action: 'replace', old_hash: 'a', new_hash: 'b' };
  const p = { indexes: [{ id: 'f1', relPath: 'x.xlsx' }], perFile: new Map([['f1', { changes: [change('One'), change('Two')] }]]), rows: [row, row] };
  assert.deepEqual([0, 1].map((i) => rowDiff(p, i).target.name), ['One', 'Two']);
});

test('a rename has no text, only the two names', () => {
  const row = { folder: '', file: 'x.xlsx', verdict: 'changed', action: 'rename', old_hash: 'h', new_hash: 'h' };
  const p = { indexes: [{ id: 'f1', relPath: 'x.xlsx' }], perFile: new Map([['f1', { changes: [{ op: 'rename', target: { type: 'query', name: 'Old' }, newName: 'New', oldHash: 'h', newHash: 'h' }] }]]), rows: [row] };
  const d = rowDiff(p, 0);
  assert.deepEqual(d.rename, { from: 'Old', to: 'New' });
  assert.equal(d.before, undefined);
});

test('a removed target shows its text going to nothing', () => {
  const row = { folder: '', file: 'x.xlsx', verdict: 'changed', action: 'remove', old_hash: 'a', new_hash: '' };
  const p = { indexes: [{ id: 'f1', relPath: 'x.xlsx' }], perFile: new Map([['f1', { changes: [{ op: 'remove', target: { type: 'module', name: 'M' }, oldHash: 'a', newHash: null, texts: { before: 'Sub A()', after: '' } }] }]]), rows: [row] };
  const d = rowDiff(p, 0);
  assert.deepEqual([d.before, d.after], ['Sub A()', '']);
});

test('no diff when the row is out of range, was not changed, or the run did not keep texts', async () => {
  const p = await previewOf([[EXT, 'pq_simple.xlsx', 'a.xlsx']], injectReplace);
  assert.equal(rowDiff(p, 5), null);
  assert.equal(rowDiff(p, -1), null);
  const run = await previewOf([[EXT, 'pq_simple.xlsx', 'a.xlsx']], injectReplace, false);
  assert.equal(rowDiff(run, 0), null);
  const skipped = { ...p, rows: [{ ...p.rows[0], verdict: 'skipped' }] };
  assert.equal(rowDiff(skipped, 0), null);
});

test('a row takes its text from its own file even when another file has a change with the same hashes', () => {
  const change = (word) => ({ op: 'replace', target: { type: 'query', name: 'Q' }, oldHash: 'a', newHash: 'b', texts: { before: `old ${word}`, after: `new ${word}` } });
  const row = (file) => ({ folder: '', file, verdict: 'changed', action: 'replace', old_hash: 'a', new_hash: 'b' });
  const p = {
    indexes: [{ id: 'f1', relPath: 'one.xlsx' }, { id: 'f2', relPath: 'two.xlsx' }],
    perFile: new Map([['f1', { changes: [change('one')] }], ['f2', { changes: [change('two')] }]]),
    rows: [row('one.xlsx'), row('two.xlsx')]
  };
  assert.deepEqual([0, 1].map((i) => rowDiff(p, i).after), ['new one', 'new two']);
});
