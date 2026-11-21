import test from 'node:test';
import assert from 'node:assert/strict';
import { openWorkbook } from '../../src/core/workbook.js';
import { executeFile } from '../../src/batch/execute/index.js';
import { indexWorkbook } from '../../src/batch/index/file-index.js';
import { sha256Text } from '../../src/batch/index/hash.js';
import { joinModuleSource } from '../../src/core/vba/module-source.js';
import { fixture, generated } from './helpers.js';

const NOW = '2026-11-14T10:00:00.000Z';
const ALIGNED_M = 'let\n    Source = 2\nin\n    Source';
const ALIGNED_VBA = 'Sub say_hello()\n    MsgBox "Aligned"\nEnd Sub\n';

const unit = { fileId: 'f0001', kind: 'workbook', name: 'f', index: 1 };
const planOf = (type, name) => ({ fileId: 'f0001', source: 'rule', units: [unit], actions: [{ unit, op: 'align', target: { type, name }, compute: null, output: null, replaces: null }], skipped: null });
const recipeOf = (target, name, hash) => ({ recipe: 'align', v: 1, scope: { type: 'workbook', match: 'all', excludeHidden: true }, align: { target, name, hash } });
const indexOf = (bytes, name) => indexWorkbook(bytes, { name, relPath: name, size: bytes.length, mtime: 0 });
const openSimple = () => openWorkbook(fixture('pq_simple.xlsx'), 'pq_simple.xlsx');
const openMixed = () => openWorkbook(generated('mixed.xlsm'), 'mixed.xlsm');
const moduleOf = (wb, name) => wb.vba.project.modules.find((m) => m.name === name);

test('F2-09: a query with the same name and a different hash is replaced by the chosen version', async () => {
  const wb = await openSimple();
  const hash = await sha256Text(ALIGNED_M);
  const bytes = fixture('pq_simple.xlsx');
  const before = (await indexOf(bytes, 'pq_simple.xlsx')).queries[0].hash;
  assert.notEqual(before, hash);
  const res = await executeFile(wb, planOf('query', 'StudentResults'), { now: NOW, recipe: recipeOf('query', 'StudentResults', hash), alignText: ALIGNED_M });
  const row = res.rows[0];
  assert.equal(row.recipe, 'align');
  assert.equal(row.action, 'align');
  assert.equal(row.verdict, 'changed');
  assert.equal(row.old_hash, before);
  assert.equal(row.new_hash, hash);
  assert.equal(row.verified, true);
  assert.deepEqual(res.changes, [{ op: 'align', target: { type: 'query', name: 'StudentResults' }, oldHash: before, newHash: hash }]);
  assert.equal((await indexOf(res.bytes, 'out.xlsx')).queries[0].hash, hash);
  assert.equal((await openWorkbook(res.bytes, 'out.xlsx')).queries[0].original, ALIGNED_M);
});

test('F2-09: a file already at the chosen hash is unchanged and nothing is written', async () => {
  const wb = await openSimple();
  const hash = await sha256Text(ALIGNED_M);
  const recipe = recipeOf('query', 'StudentResults', hash);
  const first = await executeFile(wb, planOf('query', 'StudentResults'), { now: NOW, recipe, alignText: ALIGNED_M });
  const again = await executeFile(await openWorkbook(first.bytes, 'x.xlsx'), planOf('query', 'StudentResults'), { now: NOW, recipe, alignText: ALIGNED_M });
  assert.ok(again.bytes === null);
  assert.equal(again.rows[0].verdict, 'unchanged');
  assert.equal(again.rows[0].old_hash, hash);
  assert.equal(again.rows[0].new_hash, hash);
});

test('F2-09: a file with no query of that name is skipped, and so is an action of another kind', async () => {
  const wb = await openSimple();
  const hash = await sha256Text(ALIGNED_M);
  const none = await executeFile(wb, planOf('query', 'Nope'), { now: NOW, recipe: recipeOf('query', 'Nope', hash), alignText: ALIGNED_M });
  assert.ok(none.bytes === null);
  assert.equal(none.rows[0].verdict, 'skipped');
  assert.equal(none.rows[0].reason_code, 'skip.notApplicable');
  const other = await executeFile(wb, planOf('query', 'StudentResults'), { now: NOW, recipe: recipeOf('module', 'StudentResults', hash), alignText: ALIGNED_M });
  assert.equal(other.rows[0].verdict, 'skipped');
});

test('F2-09: text that is not the chosen version fails every row and writes nothing', async () => {
  const wb = await openSimple();
  const hash = await sha256Text(ALIGNED_M);
  const res = await executeFile(wb, planOf('query', 'StudentResults'), { now: NOW, recipe: recipeOf('query', 'StudentResults', hash), alignText: `${ALIGNED_M}\n// other` });
  assert.ok(res.bytes === null);
  assert.equal(res.rows[0].verdict, 'failed');
  assert.equal(res.rows[0].reason_code, 'align.sourceChanged');
  assert.equal(res.rows[0].verified, false);
});

test('F2-09: an align without the chosen text is a caller error, not a row', async () => {
  const wb = await openSimple();
  await assert.rejects(() => executeFile(wb, planOf('query', 'StudentResults'), { now: NOW, recipe: recipeOf('query', 'StudentResults', 'ab') }), /alignText/);
});

test('F2-09: chosen query text with Windows breaks and trailing space matches the hash of its editor text', async () => {
  const wb = await openSimple();
  const hash = await sha256Text(ALIGNED_M);
  const text = `${ALIGNED_M.replace(/\n/g, '\r\n')}\r\n  `;
  const res = await executeFile(wb, planOf('query', 'StudentResults'), { now: NOW, recipe: recipeOf('query', 'StudentResults', hash), alignText: text });
  assert.equal(res.rows[0].verdict, 'changed');
  assert.equal((await openWorkbook(res.bytes, 'x.xlsx')).queries[0].original, ALIGNED_M);
});

test('F2-09: chosen text that does not parse fails the file with m.parse', async () => {
  const wb = await openSimple();
  const bad = 'let Source = in';
  const res = await executeFile(wb, planOf('query', 'StudentResults'), { now: NOW, recipe: recipeOf('query', 'StudentResults', await sha256Text(bad)), alignText: bad });
  assert.ok(res.bytes === null);
  assert.equal(res.rows[0].verdict, 'failed');
  assert.equal(res.rows[0].reason_code, 'm.parse');
});

test('F2-09: a module is aligned to the chosen full text and its index hash becomes the chosen hash', async () => {
  const wb = await openMixed();
  const full = joinModuleSource(moduleOf(wb, 'Module1').model, ALIGNED_VBA);
  const hash = await sha256Text(full);
  const bytes = generated('mixed.xlsm');
  const before = (await indexOf(bytes, 'mixed.xlsm')).modules.find((m) => m.name === 'Module1').hash;
  const res = await executeFile(wb, planOf('module', 'Module1'), { now: NOW, recipe: recipeOf('module', 'Module1', hash), alignText: full });
  const row = res.rows[0];
  assert.equal(row.verdict, 'changed');
  assert.equal(row.old_hash, before);
  assert.equal(row.new_hash, hash);
  assert.deepEqual(res.changes, [{ op: 'align', target: { type: 'module', name: 'Module1' }, oldHash: before, newHash: hash }]);
  const back = await openWorkbook(res.bytes, 'x.xlsm');
  assert.equal(moduleOf(back, 'Module1').model.visible, ALIGNED_VBA);
  assert.equal((await indexOf(res.bytes, 'x.xlsm')).modules.find((m) => m.name === 'Module1').hash, hash);
});

test('F2-09: a module already at the chosen hash is unchanged', async () => {
  const wb = await openMixed();
  const full = moduleOf(wb, 'Module1').text;
  const res = await executeFile(wb, planOf('module', 'Module1'), { now: NOW, recipe: recipeOf('module', 'Module1', await sha256Text(full)), alignText: full });
  assert.ok(res.bytes === null);
  assert.equal(res.rows[0].verdict, 'unchanged');
});

test('F2-09: a module the file does not have is skipped, and a file with no macros is skipped', async () => {
  const wb = await openMixed();
  const full = joinModuleSource(moduleOf(wb, 'Module1').model, ALIGNED_VBA);
  const recipe = recipeOf('module', 'Nope', await sha256Text(full));
  assert.equal((await executeFile(wb, planOf('module', 'Nope'), { now: NOW, recipe, alignText: full })).rows[0].verdict, 'skipped');
  const plain = await executeFile(await openSimple(), planOf('module', 'Nope'), { now: NOW, recipe, alignText: full });
  assert.equal(plain.rows[0].verdict, 'skipped');
});

test('F2-09: a signed project is refused until acknowledged, then the row says the signature was removed', async () => {
  const wb = await openWorkbook(generated('signed.xlsm'), 'signed.xlsm');
  const full = joinModuleSource(moduleOf(wb, 'Module1').model, ALIGNED_VBA);
  const recipe = recipeOf('module', 'Module1', await sha256Text(full));
  const refused = await executeFile(wb, planOf('module', 'Module1'), { now: NOW, recipe, alignText: full });
  assert.equal(refused.rows[0].reason_code, 'vba.signature');
  assert.ok(refused.bytes === null);
  const done = await executeFile(wb, planOf('module', 'Module1'), { now: NOW, recipe, alignText: full, acknowledgeSignature: true });
  assert.equal(done.rows[0].verdict, 'changed');
  assert.equal(done.rows[0].signature_removed, true);
});

test('F2-09: chosen module text that a macro cannot hold is refused with line and column', async () => {
  const wb = await openMixed();
  const full = joinModuleSource(moduleOf(wb, 'Module1').model, 'Sub A()\nx = 1\u0000\nEnd Sub\n');
  const res = await executeFile(wb, planOf('module', 'Module1'), { now: NOW, recipe: recipeOf('module', 'Module1', await sha256Text(full)), alignText: full });
  assert.ok(res.bytes === null);
  assert.equal(res.rows[0].verdict, 'refused');
  assert.equal(res.rows[0].reason_code, 'vba.nul');
  assert.equal(res.rows[0].reason, '2:6');
});

test('F2-09: the same now gives the same bytes for an align', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 14, 10, 0, 0) });
  const wb = await openSimple();
  const recipe = recipeOf('query', 'StudentResults', await sha256Text(ALIGNED_M));
  const a = await executeFile(wb, planOf('query', 'StudentResults'), { now: NOW, recipe, alignText: ALIGNED_M });
  t.mock.timers.tick(30000);
  const b = await executeFile(wb, planOf('query', 'StudentResults'), { now: NOW, recipe, alignText: ALIGNED_M });
  assert.equal(a.sha256, b.sha256);
});
