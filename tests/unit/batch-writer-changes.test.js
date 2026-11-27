import test from 'node:test';
import assert from 'node:assert/strict';
import { openWorkbook } from '../../src/core/workbook.js';
import { planChanges, reportRow } from '../../src/batch/execute/changes.js';
import { sha256Text } from '../../src/batch/index/hash.js';
import { normalizeQueryText } from '../../src/core/pq/section.js';
import { fixture, generated } from './helpers.js';

const unit = { fileId: 'f0001', kind: 'workbook', name: 'book', index: 1 };
const NEW_M = 'let\n    Source = 1\nin\n    Source';

const planFor = (type, name, op) => ({ fileId: 'f0001', source: 'rule', units: [unit], actions: [{ unit, op, target: { type, name }, compute: null, output: null, replaces: null }], skipped: null });

const injectRecipe = (over) => ({
  recipe: 'inject',
  v: 1,
  scope: { type: 'workbook', match: 'all', excludeHidden: true },
  inject: { match: 'name', newName: null, source: 'inline', text: NEW_M, refreshOnLoad: true, ...over }
});

test('a report row starts unchanged, unverified, without signature loss, and takes what the caller sets', () => {
  const meta = { name: 'a.xlsx', relPath: 'dir/a.xlsx' };
  const row = reportRow(meta, { op: 'replace' }, { recipe: 'inject' }, {});
  assert.equal(row.file, 'a.xlsx');
  assert.equal(row.folder, 'dir/');
  assert.equal(row.unit, '');
  assert.equal(row.unit_index, 0);
  assert.equal(row.action, 'replace');
  assert.equal(row.verdict, 'unchanged');
  assert.equal(row.verified, false);
  assert.equal(row.signature_removed, false);
  assert.equal(row.duration_ms, 0);
  const set = reportRow(meta, { op: 'replace', unit }, { recipe: 'inject' }, { verified: true, signature_removed: true, verdict: 'changed' });
  assert.equal(set.verified, true);
  assert.equal(set.signature_removed, true);
  assert.equal(set.verdict, 'changed');
  assert.equal(set.unit, 'book');
  assert.equal(set.unit_index, 1);
});

test('planChanges refuses to remove a signature unless the caller acknowledges it', async () => {
  const wb = await openWorkbook(generated('signed.xlsm'), 'signed.xlsm');
  const module = wb.vba.project.modules.find((m) => m.name === 'Module1');
  const recipe = injectRecipe({ target: 'module', op: 'replace', name: 'Module1', text: `${module.model.visible}\n' recipe edit` });
  const plan = planFor('module', 'Module1', 'replace');
  const refused = await planChanges(wb, plan, recipe);
  assert.equal(refused.outcomes[0].verdict, 'refused');
  assert.equal(refused.outcomes[0].reason_code, 'vba.signature');
  const done = await planChanges(wb, plan, recipe, { acknowledgeSignature: true });
  assert.equal(done.outcomes[0].verdict, 'changed');
});

test('an add refused because the name exists reports the hash of the query that holds the name', async () => {
  const wb = await openWorkbook(fixture('pq_simple.xlsx'), 'pq_simple.xlsx');
  const existing = wb.queries.find((q) => q.name === 'StudentResults');
  const recipe = injectRecipe({ target: 'query', op: 'add', name: 'studentresults' });
  const { outcomes } = await planChanges(wb, planFor('query', 'studentresults', 'add'), recipe);
  assert.equal(outcomes[0].verdict, 'refused');
  assert.equal(outcomes[0].reason_code, 'refused.exists');
  assert.equal(outcomes[0].old_hash, await sha256Text(normalizeQueryText(existing.original)));
  assert.equal(outcomes[0].new_hash, await sha256Text(NEW_M));
});
