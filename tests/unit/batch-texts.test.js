import test from 'node:test';
import assert from 'node:assert/strict';
import { runFilePlan } from '../../src/batch/execute/run-file.js';
import { indexWorkbook } from '../../src/batch/index/file-index.js';
import { resolvePlan } from '../../src/batch/resolve/resolve.js';
import { parseRecipe } from '../../src/batch/recipe/recipe.js';
import { sha256Text } from '../../src/batch/index/hash.js';
import { fixture, generated } from './helpers.js';

const NOW = '2026-11-14T10:00:00.000Z';
const NEW_M = 'let\n    Source = 2\nin\n    Source';
const LIMITS = { timeoutMs: 30000, maxRows: 1000000 };

async function run(bytes, name, json, over = {}) {
  const recipe = parseRecipe(JSON.stringify(json)).recipe;
  const meta = { id: 'f0001', name, relPath: name, size: bytes.length };
  const index = await indexWorkbook(bytes, meta);
  const filePlan = resolvePlan(recipe, [index], { now: NOW }).files[0];
  return runFilePlan(bytes, meta, filePlan, { now: NOW, dryRun: false, limits: LIMITS, culture: 'en-US', runId: 'r1', recipe, ...over });
}

const query = (op, name, text = NEW_M) => ({ recipe: 'inject', v: 1, inject: { target: 'query', op, match: 'name', name, source: 'inline', text, refreshOnLoad: false } });
const module = (op, name, text = 'Sub A()\r\nEnd Sub\r\n') => ({ recipe: 'inject', v: 1, inject: { target: 'module', op, match: 'name', name, source: 'inline', text, refreshOnLoad: false } });
const replaceCode = { recipe: 'replace', v: 1, replace: { in: ['m', 'vba'], find: 'DateTime', with: 'MyDateTime', kind: 'text', matchCase: true } };

test('with includeTexts a replaced query carries its text before and after, and the after text is the text that was hashed', async () => {
  const res = await run(fixture('pq_simple.xlsx'), 'pq_simple.xlsx', query('replace', 'StudentResults'), { includeTexts: true });
  const [change] = res.changes;
  assert.equal(change.op, 'replace');
  assert.equal(await sha256Text(change.texts.before), change.oldHash);
  assert.equal(await sha256Text(change.texts.after), change.newHash);
  assert.equal(change.texts.after, NEW_M);
  assert.notEqual(change.texts.before, change.texts.after);
});

test('without includeTexts no change carries any text, so a run keeps its records small', async () => {
  const res = await run(fixture('pq_simple.xlsx'), 'pq_simple.xlsx', query('replace', 'StudentResults'));
  assert.deepEqual(res.changes.map((c) => Object.keys(c).sort()), [['newHash', 'oldHash', 'op', 'target']]);
});

test('asking for texts changes neither the bytes nor the hash nor the rows', async () => {
  const plain = await run(fixture('pq_simple.xlsx'), 'pq_simple.xlsx', query('replace', 'StudentResults'));
  const withTexts = await run(fixture('pq_simple.xlsx'), 'pq_simple.xlsx', query('replace', 'StudentResults'), { includeTexts: true });
  assert.equal(withTexts.sha256, plain.sha256);
  assert.deepEqual(Array.from(withTexts.bytes), Array.from(plain.bytes));
  assert.deepEqual(withTexts.rows.map((r) => ({ ...r, duration_ms: 0 })), plain.rows.map((r) => ({ ...r, duration_ms: 0 })));
});

test('an added query has no before text and its after text is what was hashed', async () => {
  const res = await run(fixture('pq_simple.xlsx'), 'pq_simple.xlsx', query('add', 'Brand New'), { includeTexts: true });
  const [change] = res.changes;
  assert.equal(change.op, 'add');
  assert.equal(change.texts.before, '');
  assert.equal(await sha256Text(change.texts.after), change.newHash);
});

test('a replace in code shows the whole text before and after, with the match changed and nothing else', async () => {
  const res = await run(generated('mixed.xlsm'), 'mixed.xlsm', replaceCode, { includeTexts: true });
  const changed = res.changes.filter((c) => c.op === 'replaceText');
  assert.ok(changed.length > 0);
  for (const c of changed) {
    assert.ok(c.texts.before.includes('DateTime'));
    assert.equal(c.texts.after, c.texts.before.split('DateTime').join('MyDateTime'));
    if (c.target.type === 'query') assert.equal(await sha256Text(c.texts.after), c.newHash);
  }
});

test('a replaced module shows its visible text before and after', async () => {
  const res = await run(generated('mixed.xlsm'), 'mixed.xlsm', module('replace', 'Module1'), { includeTexts: true });
  const [change] = res.changes;
  assert.equal(change.target.type, 'module');
  assert.equal(change.texts.after, 'Sub A()\nEnd Sub\n');
  assert.ok(change.texts.before.length > 0);
  assert.notEqual(change.texts.before, change.texts.after);
});
