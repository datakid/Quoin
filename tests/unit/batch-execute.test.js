import test from 'node:test';
import assert from 'node:assert/strict';
import { openWorkbook } from '../../src/core/workbook.js';
import { applyChangeSet } from '../../src/core/save.js';
import { checkSection } from '../../src/core/m/engine.js';
import { executeFile } from '../../src/batch/execute/index.js';
import { planChanges } from '../../src/batch/execute/changes.js';
import { REPORT_COLUMNS, zipClock } from '../../src/batch/execute/collect.js';
import { sha256Text, sha256Bytes } from '../../src/batch/index/hash.js';
import { normalizeQueryText } from '../../src/core/pq/section.js';
import { joinModuleSource } from '../../src/core/vba/module-source.js';
import { newModuleText } from '../../src/core/vba/writeback.js';
import { indexWorkbook } from '../../src/batch/index/file-index.js';
import { fixture, generated } from './helpers.js';

const NOW = '2026-11-14T10:00:00.000Z';
const NEW_M = 'let\n    Source = 1\nin\n    Source';

const recipeFor = (over = {}) => ({
  recipe: 'inject',
  v: 1,
  scope: { type: 'workbook', match: 'all', excludeHidden: true },
  inject: { target: 'query', op: 'replace', match: 'name', name: 'StudentResults', newName: null, source: 'inline', text: NEW_M, refreshOnLoad: true, ...over }
});

function filePlanFor(names, op = 'replace') {
  const unit = { fileId: 'f0001', kind: 'workbook', name: 'pq_simple', index: 1 };
  return { fileId: 'f0001', source: 'rule', units: [unit], actions: names.map((name) => ({ unit, op, target: { type: 'query', name }, compute: null, output: null, replaces: null })), skipped: null };
}

const open = (name = 'pq_simple.xlsx') => openWorkbook(fixture(name), name);

test('F2-02: a replace action becomes a ChangeSet that replaces the query with trimmed text', async () => {
  const wb = await open();
  const { changeSet, outcomes } = await planChanges(wb, filePlanFor(['StudentResults']), recipeFor({ text: `\n\n${NEW_M}  \n` }));
  assert.deepEqual([...changeSet.queries.replace], [['StudentResults', NEW_M]]);
  assert.equal(changeSet.queries.add.size + changeSet.queries.rename.size + changeSet.queries.remove.size, 0);
  assert.deepEqual([...changeSet.refreshOnLoad], ['StudentResults']);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].verdict, 'changed');
  assert.equal(outcomes[0].old_hash, await sha256Text(normalizeQueryText(wb.queries[0].original)));
  assert.equal(outcomes[0].new_hash, await sha256Text(NEW_M));
});

test('F2-02: the recipe decides whether the query refreshes on open', async () => {
  const wb = await open();
  const off = await planChanges(wb, filePlanFor(['StudentResults']), recipeFor({ refreshOnLoad: false }));
  assert.equal(off.changeSet.refreshOnLoad.size, 0);
  const unset = await planChanges(wb, filePlanFor(['StudentResults']), recipeFor({ refreshOnLoad: undefined }));
  assert.equal(unset.changeSet.refreshOnLoad.size, 0);
  const res = await executeFile(wb, filePlanFor(['StudentResults']), { now: NOW, recipe: recipeFor({ refreshOnLoad: false }) });
  const back = await openWorkbook(res.bytes, 'x.xlsx');
  assert.equal(back.queries[0].connection.refreshOnLoad, false);
  const on = await executeFile(wb, filePlanFor(['StudentResults']), { now: NOW, recipe: recipeFor({ refreshOnLoad: true }) });
  assert.equal((await openWorkbook(on.bytes, 'x.xlsx')).queries[0].connection.refreshOnLoad, true);
});

test('F2-02: executeFile returns the new bytes, their hash, the change and one report row', async () => {
  const wb = await open();
  const res = await executeFile(wb, filePlanFor(['StudentResults']), { now: NOW, recipe: recipeFor(), runId: 'r1', meta: { name: 'pq_simple.xlsx', relPath: 'east/pq_simple.xlsx' } });
  assert.equal(res.fileId, 'f0001');
  assert.ok(res.bytes instanceof Uint8Array);
  assert.equal(res.sha256, await sha256Bytes(res.bytes));
  const back = await openWorkbook(res.bytes, 'x.xlsx');
  assert.equal(back.queries[0].original, NEW_M);
  assert.deepEqual(res.changes, [{ op: 'replace', target: { type: 'query', name: 'StudentResults' }, oldHash: await sha256Text(normalizeQueryText(wb.queries[0].original)), newHash: await sha256Text(NEW_M) }]);
  assert.deepEqual(res.warnings, []);
  assert.equal(res.rows.length, 1);
  const row = res.rows[0];
  assert.deepEqual(Object.keys(row), REPORT_COLUMNS);
  assert.equal(row.run_id, 'r1');
  assert.equal(row.file, 'pq_simple.xlsx');
  assert.equal(row.folder, 'east/');
  assert.equal(row.unit, 'pq_simple');
  assert.equal(row.unit_index, 1);
  assert.equal(row.recipe, 'inject');
  assert.equal(row.action, 'replace');
  assert.equal(row.compute, '');
  assert.equal(row.verdict, 'changed');
  assert.equal(row.old_hash, res.changes[0].oldHash);
  assert.equal(row.new_hash, res.changes[0].newHash);
  assert.equal(row.verified, true);
  assert.equal(row.signature_removed, false);
  assert.ok(Number.isInteger(row.duration_ms) && row.duration_ms >= 0);
});

test('F2-02: the bytes are exactly what applyChangeSet gives for that ChangeSet and clock', async () => {
  const wb = await open();
  const recipe = recipeFor();
  const { changeSet } = await planChanges(wb, filePlanFor(['StudentResults']), recipe);
  const direct = await applyChangeSet(wb, changeSet, { now: zipClock(NOW), refreshOnLoad: false, checkSection });
  const res = await executeFile(wb, filePlanFor(['StudentResults']), { now: NOW, recipe });
  assert.equal(res.sha256, await sha256Bytes(direct.bytes));
});

test('F2-02: the same now gives byte-identical output even when the clock moves', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 14, 10, 0, 0) });
  const wb = await open();
  const first = await executeFile(wb, filePlanFor(['StudentResults']), { now: NOW, recipe: recipeFor() });
  t.mock.timers.tick(30000);
  const second = await executeFile(wb, filePlanFor(['StudentResults']), { now: NOW, recipe: recipeFor() });
  assert.equal(first.sha256, second.sha256);
  const later = await executeFile(wb, filePlanFor(['StudentResults']), { now: '2026-12-01T08:30:00.000Z', recipe: recipeFor() });
  assert.notEqual(later.sha256, first.sha256);
});

test('F2-02: execute never reads dryRun', async () => {
  const wb = await open();
  let reads = 0;
  const options = { now: NOW, recipe: recipeFor() };
  Object.defineProperty(options, 'dryRun', {
    enumerable: true,
    get() {
      reads += 1;
      return true;
    }
  });
  const res = await executeFile(wb, filePlanFor(['StudentResults']), options);
  assert.equal(reads, 0);
  assert.ok(res.bytes);
});

test('F2-02: text with Windows line breaks is stored with the same breaks as typed text', async () => {
  const wb = await open();
  const res = await executeFile(wb, filePlanFor(['StudentResults']), { now: NOW, recipe: recipeFor({ text: NEW_M.replace(/\n/g, '\r\n') }) });
  assert.equal((await openWorkbook(res.bytes, 'x.xlsx')).queries[0].original, NEW_M);
});

test('F2-02: the same text as the query gives unchanged and no bytes', async () => {
  const wb = await open();
  const res = await executeFile(wb, filePlanFor(['StudentResults']), { now: NOW, recipe: recipeFor({ text: `${wb.queries[0].original}\n` }) });
  assert.equal(res.bytes, null);
  assert.equal(res.sha256, null);
  assert.deepEqual(res.changes, []);
  assert.equal(res.rows[0].verdict, 'unchanged');
  assert.equal(res.rows[0].old_hash, res.rows[0].new_hash);
  assert.equal(res.rows[0].verified, true);
});

test('F2-02: a query that is not in the file is skipped, and so is a file with no query data', async () => {
  const wb = await open();
  const missing = await executeFile(wb, filePlanFor(['Nope']), { now: NOW, recipe: recipeFor({ name: 'Nope' }) });
  assert.equal(missing.bytes, null);
  assert.equal(missing.rows[0].verdict, 'skipped');
  assert.equal(missing.rows[0].reason_code, 'skip.notApplicable');
  const plain = await open('plain_table.xlsx');
  const none = await executeFile(plain, filePlanFor(['StudentResults']), { now: NOW, recipe: recipeFor() });
  assert.equal(none.bytes, null);
  assert.equal(none.rows[0].verdict, 'skipped');
});

test('F2-02: text that does not parse fails the file with m.parse and writes nothing', async () => {
  const wb = await open();
  const res = await executeFile(wb, filePlanFor(['StudentResults']), { now: NOW, recipe: recipeFor({ text: 'let Source = in' }) });
  assert.equal(res.bytes, null);
  assert.equal(res.sha256, null);
  assert.deepEqual(res.changes, []);
  assert.equal(res.rows[0].verdict, 'failed');
  assert.equal(res.rows[0].reason_code, 'm.parse');
  assert.equal(res.rows[0].verified, false);
});

test('F2-02: a failed self-check releases nothing and reports not-released', async () => {
  const wb = await openWorkbook(generated('mixed.xlsm'), 'mixed.xlsm');
  const raw = wb.queries.find((q) => q.name === 'RawInput');
  raw.original = `${raw.original}\n// tampered after open`;
  const res = await executeFile(wb, filePlanFor(['FinalTable']), { now: NOW, recipe: recipeFor({ name: 'FinalTable' }) });
  assert.ok(res.bytes === null);
  assert.ok(res.sha256 === null);
  assert.equal(res.rows[0].verdict, 'not-released');
  assert.equal(res.rows[0].reason_code, 'write.selfcheck');
  assert.equal(res.rows[0].verified, false);
});

test('F2-02: an error that is not a Quoin error is not turned into a row', async () => {
  const wb = await open();
  wb.pkg = null;
  await assert.rejects(() => executeFile(wb, filePlanFor(['StudentResults']), { now: NOW, recipe: recipeFor() }), TypeError);
});

test('F2-02: an op that is not built yet is refused, not skipped', async () => {
  const wb = await open();
  await assert.rejects(() => executeFile(wb, filePlanFor(['StudentResults'], 'transform'), { now: NOW, recipe: recipeFor() }), /not supported yet/);
});

test('F2-03: an add action writes a new connection-only query and reports no old hash', async () => {
  const wb = await open();
  const res = await executeFile(wb, filePlanFor(['Extra'], 'add'), { now: NOW, recipe: recipeFor({ op: 'add', name: 'Extra' }) });
  const back = await openWorkbook(res.bytes, 'x.xlsx');
  assert.deepEqual(back.queries.map((q) => q.name), ['StudentResults', 'Extra']);
  assert.equal(back.queries[1].original, NEW_M);
  assert.deepEqual(back.warnings, []);
  assert.deepEqual(res.changes, [{ op: 'add', target: { type: 'query', name: 'Extra' }, oldHash: null, newHash: await sha256Text(NEW_M) }]);
  const row = res.rows[0];
  assert.equal(row.action, 'add');
  assert.equal(row.verdict, 'changed');
  assert.equal(row.old_hash, '');
  assert.equal(row.new_hash, await sha256Text(NEW_M));
  assert.equal(row.verified, true);
});

test('F2-03: an add of a name the file already has is refused and writes nothing', async () => {
  const wb = await open();
  const res = await executeFile(wb, filePlanFor(['studentresults'], 'add'), { now: NOW, recipe: recipeFor({ op: 'add', name: 'studentresults' }) });
  assert.ok(res.bytes === null);
  assert.equal(res.rows[0].verdict, 'refused');
  assert.equal(res.rows[0].reason_code, 'refused.exists');
});

test('F2-03: an add with a name that cannot be written is refused', async () => {
  const wb = await open();
  const res = await executeFile(wb, filePlanFor([' Extra'], 'add'), { now: NOW, recipe: recipeFor({ op: 'add', name: ' Extra' }) });
  assert.ok(res.bytes === null);
  assert.equal(res.rows[0].verdict, 'refused');
  assert.equal(res.rows[0].reason_code, 'refused.name');
});

test('F2-03: an add to a file with no query data is refused with pq.none', async () => {
  const wb = await open('plain_table.xlsx');
  const res = await executeFile(wb, filePlanFor(['Extra'], 'add'), { now: NOW, recipe: recipeFor({ op: 'add', name: 'Extra' }) });
  assert.ok(res.bytes === null);
  assert.equal(res.rows[0].verdict, 'refused');
  assert.equal(res.rows[0].reason_code, 'pq.none');
});

test('F2-03: an add and a replace in one file give one write and one row each', async () => {
  const wb = await open();
  const plan = filePlanFor(['Extra'], 'add');
  plan.actions.push(...filePlanFor(['StudentResults']).actions);
  const res = await executeFile(wb, plan, { now: NOW, recipe: recipeFor({ op: 'add', name: 'Extra' }) });
  const back = await openWorkbook(res.bytes, 'x.xlsx');
  assert.deepEqual(back.queries.map((q) => q.name), ['StudentResults', 'Extra']);
  assert.deepEqual(res.rows.map((r) => [r.action, r.verdict]), [['add', 'changed'], ['replace', 'changed']]);
  assert.equal(res.changes.length, 2);
});

async function withAdded(...names) {
  const wb = await open();
  const plan = filePlanFor(names, 'add');
  const res = await executeFile(wb, plan, { now: NOW, recipe: recipeFor({ op: 'add', name: names[0] }) });
  return openWorkbook(res.bytes, 'x.xlsx');
}

const removeRecipe = (name) => recipeFor({ op: 'remove', name });

test('F2-04: a remove action takes out a query that nothing uses and reports its old hash', async () => {
  const wb = await withAdded('Extra');
  const res = await executeFile(wb, filePlanFor(['Extra'], 'remove'), { now: NOW, recipe: removeRecipe('Extra') });
  const back = await openWorkbook(res.bytes, 'x.xlsx');
  assert.deepEqual(back.queries.map((q) => q.name), ['StudentResults']);
  assert.deepEqual(res.changes, [{ op: 'remove', target: { type: 'query', name: 'Extra' }, oldHash: await sha256Text(NEW_M), newHash: null }]);
  const row = res.rows[0];
  assert.equal(row.action, 'remove');
  assert.equal(row.verdict, 'changed');
  assert.equal(row.old_hash, await sha256Text(NEW_M));
  assert.equal(row.new_hash, '');
  assert.equal(row.verified, true);
});

test('F2-04: a query that loads to a table is refused with its target and nothing is written', async () => {
  const wb = await open();
  const res = await executeFile(wb, filePlanFor(['StudentResults'], 'remove'), { now: NOW, recipe: removeRecipe('StudentResults') });
  assert.ok(res.bytes === null);
  assert.equal(res.rows[0].verdict, 'refused');
  assert.equal(res.rows[0].reason_code, 'refused.loaded');
  assert.equal(res.rows[0].reason, `${wb.queries[0].load.sheet}!${wb.queries[0].load.tableName}`);
  assert.equal(res.rows[0].old_hash, await sha256Text(normalizeQueryText(wb.queries[0].original)));
});

test('F2-04: a query that another query uses is refused and names the users', async () => {
  const wb = await open();
  const plan = filePlanFor(['A', 'B'], 'add');
  const base = await executeFile(wb, { ...plan, actions: [plan.actions[0]] }, { now: NOW, recipe: recipeFor({ op: 'add', name: 'A' }) });
  const withA = await openWorkbook(base.bytes, 'x.xlsx');
  const second = await executeFile(withA, { ...plan, actions: [plan.actions[1]] }, { now: NOW, recipe: recipeFor({ op: 'add', name: 'B', text: 'A + 1' }) });
  const both = await openWorkbook(second.bytes, 'x.xlsx');
  const res = await executeFile(both, filePlanFor(['A'], 'remove'), { now: NOW, recipe: removeRecipe('A') });
  assert.ok(res.bytes === null);
  assert.equal(res.rows[0].verdict, 'refused');
  assert.equal(res.rows[0].reason_code, 'refused.usedBy');
  assert.equal(res.rows[0].reason, 'B');
});

test('F2-04: a remove of a query the file does not have is skipped', async () => {
  for (const name of ['pq_simple.xlsx', 'plain_table.xlsx']) {
    const wb = await open(name);
    const res = await executeFile(wb, filePlanFor(['Nope'], 'remove'), { now: NOW, recipe: removeRecipe('Nope') });
    assert.ok(res.bytes === null);
    assert.equal(res.rows[0].verdict, 'skipped');
    assert.equal(res.rows[0].reason_code, 'skip.notApplicable');
  }
});

const renameRecipe = (name, newName) => recipeFor({ op: 'rename', name, newName });

test('F2-05: a rename action renames a query that nothing uses and carries the new name in its change', async () => {
  const wb = await withAdded('Extra');
  const hash = await sha256Text(NEW_M);
  const res = await executeFile(wb, filePlanFor(['Extra'], 'rename'), { now: NOW, recipe: renameRecipe('Extra', 'Renamed') });
  const back = await openWorkbook(res.bytes, 'x.xlsx');
  assert.deepEqual(back.queries.map((q) => q.name), ['StudentResults', 'Renamed']);
  assert.equal(back.queries[1].original, NEW_M);
  assert.deepEqual(res.changes, [{ op: 'rename', target: { type: 'query', name: 'Extra' }, newName: 'Renamed', oldHash: hash, newHash: hash }]);
  const row = res.rows[0];
  assert.equal(row.action, 'rename');
  assert.equal(row.verdict, 'changed');
  assert.equal(row.old_hash, hash);
  assert.equal(row.new_hash, hash);
  assert.equal(row.verified, true);
});

test('F2-05: renaming to the name it already has is unchanged and writes nothing', async () => {
  const wb = await withAdded('Extra');
  const res = await executeFile(wb, filePlanFor(['Extra'], 'rename'), { now: NOW, recipe: renameRecipe('Extra', 'Extra') });
  assert.ok(res.bytes === null);
  assert.equal(res.rows[0].verdict, 'unchanged');
});

test('F2-05: a rename of a query the file does not have is skipped', async () => {
  const wb = await open();
  const res = await executeFile(wb, filePlanFor(['Nope'], 'rename'), { now: NOW, recipe: renameRecipe('Nope', 'Other') });
  assert.ok(res.bytes === null);
  assert.equal(res.rows[0].verdict, 'skipped');
  assert.equal(res.rows[0].reason_code, 'skip.notApplicable');
});

test('F2-05: a rename of a loaded query is refused with its target', async () => {
  const wb = await open();
  const res = await executeFile(wb, filePlanFor(['StudentResults'], 'rename'), { now: NOW, recipe: renameRecipe('StudentResults', 'Other') });
  assert.ok(res.bytes === null);
  assert.equal(res.rows[0].verdict, 'refused');
  assert.equal(res.rows[0].reason_code, 'refused.renameLoaded');
  assert.equal(res.rows[0].reason, `${wb.queries[0].load.sheet}!${wb.queries[0].load.tableName}`);
});

test('F2-05: a rename of a query other queries use is refused and names them', async () => {
  const wb = await withAdded('A');
  const plan = filePlanFor(['B'], 'add');
  const second = await executeFile(wb, plan, { now: NOW, recipe: recipeFor({ op: 'add', name: 'B', text: 'A + 1' }) });
  const both = await openWorkbook(second.bytes, 'x.xlsx');
  const res = await executeFile(both, filePlanFor(['A'], 'rename'), { now: NOW, recipe: renameRecipe('A', 'C') });
  assert.ok(res.bytes === null);
  assert.equal(res.rows[0].reason_code, 'refused.referenced');
  assert.equal(res.rows[0].reason, 'B');
});

test('F2-05: a rename to a name that is taken or cannot be written is refused', async () => {
  const wb = await withAdded('Extra');
  const taken = await executeFile(wb, filePlanFor(['Extra'], 'rename'), { now: NOW, recipe: renameRecipe('Extra', 'studentresults') });
  assert.equal(taken.rows[0].verdict, 'refused');
  assert.equal(taken.rows[0].reason_code, 'refused.exists');
  const bad = await executeFile(wb, filePlanFor(['Extra'], 'rename'), { now: NOW, recipe: renameRecipe('Extra', ' x') });
  assert.equal(bad.rows[0].reason_code, 'refused.name');
  const none = await executeFile(wb, filePlanFor(['Extra'], 'rename'), { now: NOW, recipe: renameRecipe('Extra', null) });
  assert.equal(none.rows[0].reason_code, 'refused.name');
  assert.ok(taken.bytes === null && bad.bytes === null && none.bytes === null);
});

test('F2-05: a change of case only is a rename in the output', async () => {
  const wb = await withAdded('Extra');
  const res = await executeFile(wb, filePlanFor(['Extra'], 'rename'), { now: NOW, recipe: renameRecipe('Extra', 'EXTRA') });
  assert.deepEqual((await openWorkbook(res.bytes, 'x.xlsx')).queries.map((q) => q.name), ['StudentResults', 'EXTRA']);
});

const openMixed = () => openWorkbook(generated('mixed.xlsm'), 'mixed.xlsm');
const moduleOf = (wb, name) => wb.vba.project.modules.find((m) => m.name === name);

function modulePlan(names, op = 'replace') {
  const unit = { fileId: 'f0001', kind: 'workbook', name: 'mixed', index: 1 };
  return { fileId: 'f0001', source: 'rule', units: [unit], actions: names.map((name) => ({ unit, op, target: { type: 'module', name }, compute: null, output: null, replaces: null })), skipped: null };
}

const moduleRecipe = (name, text) => recipeFor({ target: 'module', op: 'replace', name, text });

test('F2-06: a replace action for a module writes the new text and reports both hashes', async () => {
  const wb = await openMixed();
  const before = moduleOf(wb, 'Module1').model.visible;
  const text = `${before}\n' recipe edit`;
  const res = await executeFile(wb, modulePlan(['Module1']), { now: NOW, recipe: moduleRecipe('Module1', text) });
  const back = await openWorkbook(res.bytes, 'x.xlsm');
  assert.equal(moduleOf(back, 'Module1').model.visible, text);
  assert.equal(moduleOf(back, 'ThisWorkbook').model.visible, moduleOf(wb, 'ThisWorkbook').model.visible);
  const oldFull = moduleOf(wb, 'Module1').text;
  const newFull = joinModuleSource(moduleOf(wb, 'Module1').model, text);
  assert.deepEqual(res.changes, [{ op: 'replace', target: { type: 'module', name: 'Module1' }, oldHash: await sha256Text(oldFull), newHash: await sha256Text(newFull) }]);
  const row = res.rows[0];
  assert.equal(row.action, 'replace');
  assert.equal(row.verdict, 'changed');
  assert.equal(row.old_hash, await sha256Text(oldFull));
  assert.equal(row.new_hash, await sha256Text(newFull));
  const bytes = generated('mixed.xlsm');
  const index = await indexWorkbook(bytes, { name: 'mixed.xlsm', relPath: 'mixed.xlsm', size: bytes.length, mtime: 0 });
  assert.equal(row.old_hash, index.modules.find((m) => m.name === 'Module1').hash);
  const after = await indexWorkbook(res.bytes, { name: 'mixed.xlsm', relPath: 'mixed.xlsm', size: res.bytes.length, mtime: 0 });
  assert.equal(row.new_hash, after.modules.find((m) => m.name === 'Module1').hash);
  assert.equal(row.verified, true);
  assert.equal(row.signature_removed, false);
});

test('F2-06: module text with Windows or old Mac line breaks is stored with one break style', async () => {
  const wb = await openMixed();
  const text = "Option Explicit\r\nSub A()\r\nEnd Sub\rSub B()\nEnd Sub";
  const res = await executeFile(wb, modulePlan(['Module1']), { now: NOW, recipe: moduleRecipe('Module1', text) });
  assert.equal(moduleOf(await openWorkbook(res.bytes, 'x.xlsm'), 'Module1').model.visible, 'Option Explicit\nSub A()\nEnd Sub\nSub B()\nEnd Sub');
});

test('F2-06: the same text as the module is unchanged and writes nothing', async () => {
  const wb = await openMixed();
  const res = await executeFile(wb, modulePlan(['Module1']), { now: NOW, recipe: moduleRecipe('Module1', moduleOf(wb, 'Module1').model.visible) });
  assert.ok(res.bytes === null);
  assert.equal(res.rows[0].verdict, 'unchanged');
});

test('F2-06: a module the file does not have, or a file with no macros, is skipped', async () => {
  const wb = await openMixed();
  const missing = await executeFile(wb, modulePlan(['Nope']), { now: NOW, recipe: moduleRecipe('Nope', 'x') });
  assert.equal(missing.rows[0].verdict, 'skipped');
  assert.equal(missing.rows[0].reason_code, 'skip.notApplicable');
  const plain = await open();
  const none = await executeFile(plain, modulePlan(['Module1']), { now: NOW, recipe: moduleRecipe('Module1', 'x') });
  assert.ok(none.bytes === null);
  assert.equal(none.rows[0].verdict, 'skipped');
});

test('F2-06: text a macro cannot hold blocks the row with the line and column', async () => {
  const wb = await openMixed();
  const res = await executeFile(wb, modulePlan(['Module1']), { now: NOW, recipe: moduleRecipe('Module1', 'Option Explicit\nDim a\u0000') });
  assert.ok(res.bytes === null);
  assert.equal(res.rows[0].verdict, 'refused');
  assert.equal(res.rows[0].reason_code, 'vba.nul');
  assert.equal(res.rows[0].reason, '2:6');
  assert.equal(res.rows[0].verified, false);
  const wide = await executeFile(wb, modulePlan(['Module1']), { now: NOW, recipe: moduleRecipe('Module1', 'Sub A()\n  x = "\u0100"\nEnd Sub') });
  assert.equal(wide.rows[0].reason_code, 'vba.encoding');
  assert.equal(wide.rows[0].reason, '2:8');
});

test('F2-06: a signed project is refused until the signature loss is acknowledged, then the row says it was removed', async () => {
  const wb = await openWorkbook(generated('signed.xlsm'), 'signed.xlsm');
  const text = `${moduleOf(wb, 'Module1').model.visible}\n' recipe edit`;
  const refused = await executeFile(wb, modulePlan(['Module1']), { now: NOW, recipe: moduleRecipe('Module1', text) });
  assert.ok(refused.bytes === null);
  assert.equal(refused.rows[0].verdict, 'refused');
  assert.equal(refused.rows[0].reason_code, 'vba.signature');
  const done = await executeFile(wb, modulePlan(['Module1']), { now: NOW, recipe: moduleRecipe('Module1', text), acknowledgeSignature: true });
  assert.equal(done.rows[0].verdict, 'changed');
  assert.equal(done.rows[0].signature_removed, true);
  assert.equal((await openWorkbook(done.bytes, 'x.xlsm')).vba.signed, false);
});

test('F2-06: an unsigned project is not marked as losing a signature even when the caller acknowledges', async () => {
  const wb = await openMixed();
  const res = await executeFile(wb, modulePlan(['Module1']), { now: NOW, recipe: moduleRecipe('Module1', 'Option Explicit'), acknowledgeSignature: true });
  assert.equal(res.rows[0].signature_removed, false);
});

test('F2-06: a locked or unreadable project is refused with its own reason', async () => {
  const locked = await openMixed();
  locked.vba.project.writable = false;
  locked.vba.project.locked = true;
  const a = await executeFile(locked, modulePlan(['Module1']), { now: NOW, recipe: moduleRecipe('Module1', 'Option Explicit') });
  assert.equal(a.rows[0].verdict, 'refused');
  assert.equal(a.rows[0].reason_code, 'vba.locked');
  const broken = await openMixed();
  broken.vba = { ...broken.vba, project: null, error: 'vba.dir' };
  const b = await executeFile(broken, modulePlan(['Module1']), { now: NOW, recipe: moduleRecipe('Module1', 'Option Explicit') });
  assert.equal(b.rows[0].reason_code, 'vba.dir');
  const other = await openMixed();
  other.vba.project.writable = false;
  const c = await executeFile(other, modulePlan(['Module1']), { now: NOW, recipe: moduleRecipe('Module1', 'Option Explicit') });
  assert.equal(c.rows[0].reason_code, 'vba.write');
  const unread = await openMixed();
  moduleOf(unread, 'Module1').model = null;
  const d = await executeFile(unread, modulePlan(['Module1']), { now: NOW, recipe: moduleRecipe('Module1', 'Option Explicit') });
  assert.equal(d.rows[0].reason_code, 'vba.unreadable');
  assert.ok(a.bytes === null && b.bytes === null && c.bytes === null && d.bytes === null);
});

test('F2-06: the same now gives the same bytes for a module replace, even when the clock moves', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 14, 10, 0, 0) });
  const wb = await openMixed();
  const recipe = moduleRecipe('Module1', 'Option Explicit\nSub A()\nEnd Sub');
  const first = await executeFile(wb, modulePlan(['Module1']), { now: NOW, recipe });
  t.mock.timers.tick(30000);
  const second = await executeFile(wb, modulePlan(['Module1']), { now: NOW, recipe });
  assert.equal(first.sha256, second.sha256);
  assert.equal(first.rows[0].verified, true);
});

const NEW_VBA = 'Sub Added()\n    MsgBox "added"\nEnd Sub\n';
const moduleAddRecipe = (name, text = NEW_VBA) => recipeFor({ target: 'module', op: 'add', name, text });
const moduleRemoveRecipe = (name) => recipeFor({ target: 'module', op: 'remove', name });
const indexed = (bytes, name) => indexWorkbook(bytes, { name, relPath: name, size: bytes.length, mtime: 0 });

test('F2-07: an add action for a module writes a standard module and its hash is the index hash', async () => {
  const wb = await openMixed();
  const res = await executeFile(wb, modulePlan(['Module2'], 'add'), { now: NOW, recipe: moduleAddRecipe('Module2') });
  const back = await openWorkbook(res.bytes, 'x.xlsm');
  assert.deepEqual(back.vba.project.modules.map((m) => m.name), ['Module1', 'ThisWorkbook', 'Sheet1', 'Module2']);
  assert.equal(moduleOf(back, 'Module2').model.visible, NEW_VBA);
  assert.equal(moduleOf(back, 'Module2').kind, 'standard');
  const hash = await sha256Text(newModuleText('Module2', NEW_VBA));
  assert.deepEqual(res.changes, [{ op: 'add', target: { type: 'module', name: 'Module2' }, oldHash: null, newHash: hash }]);
  const row = res.rows[0];
  assert.equal(row.action, 'add');
  assert.equal(row.verdict, 'changed');
  assert.equal(row.old_hash, '');
  assert.equal(row.new_hash, hash);
  assert.equal(row.verified, true);
  assert.equal(row.signature_removed, false);
  assert.equal((await indexed(res.bytes, 'x.xlsm')).modules.find((m) => m.name === 'Module2').hash, hash);
});

test('F2-07: added module text gets one break style and a final line break', async () => {
  const wb = await openMixed();
  const res = await executeFile(wb, modulePlan(['Module2'], 'add'), { now: NOW, recipe: moduleAddRecipe('Module2', 'Sub A()\r\nEnd Sub') });
  assert.equal(moduleOf(await openWorkbook(res.bytes, 'x.xlsm'), 'Module2').model.visible, 'Sub A()\nEnd Sub\n');
});

test('F2-07: an add of a name the project has, or a name VBA would not accept, is refused', async () => {
  const wb = await openMixed();
  const taken = await executeFile(wb, modulePlan(['module1'], 'add'), { now: NOW, recipe: moduleAddRecipe('module1') });
  assert.equal(taken.rows[0].verdict, 'refused');
  assert.equal(taken.rows[0].reason_code, 'refused.exists');
  for (const name of ['1abc', 'Sub', 'a b', '']) {
    const res = await executeFile(wb, modulePlan([name], 'add'), { now: NOW, recipe: moduleAddRecipe(name) });
    assert.equal(res.rows[0].reason_code, 'refused.name', JSON.stringify(name));
    assert.ok(res.bytes === null);
  }
  assert.ok(taken.bytes === null);
});

test('F2-07: an add to a file with no macro project is refused', async () => {
  const res = await executeFile(await open(), modulePlan(['Module2'], 'add'), { now: NOW, recipe: moduleAddRecipe('Module2') });
  assert.ok(res.bytes === null);
  assert.equal(res.rows[0].verdict, 'refused');
  assert.equal(res.rows[0].reason_code, 'refused.noMacros');
});

test('F2-07: added module text a macro cannot hold is refused with its line and column', async () => {
  const wb = await openMixed();
  const nul = await executeFile(wb, modulePlan(['Module2'], 'add'), { now: NOW, recipe: moduleAddRecipe('Module2', 'Sub A()\nx = 1\u0000\nEnd Sub') });
  assert.equal(nul.rows[0].reason_code, 'vba.nul');
  assert.equal(nul.rows[0].reason, '2:6');
  const wide = await executeFile(wb, modulePlan(['Module2'], 'add'), { now: NOW, recipe: moduleAddRecipe('Module2', 'x = "\u0100"') });
  assert.equal(wide.rows[0].reason_code, 'vba.encoding');
  const attr = await executeFile(wb, modulePlan(['Module2'], 'add'), { now: NOW, recipe: moduleAddRecipe('Module2', 'Attribute VB_Name = "X"\nSub A()\nEnd Sub') });
  assert.equal(attr.rows[0].reason_code, 'vba.attribute');
  assert.ok(nul.bytes === null && wide.bytes === null && attr.bytes === null);
});

test('F2-07: adding a module to a signed project is refused until acknowledged, then the signature is gone', async () => {
  const wb = await openWorkbook(generated('signed.xlsm'), 'signed.xlsm');
  const refused = await executeFile(wb, modulePlan(['Module2'], 'add'), { now: NOW, recipe: moduleAddRecipe('Module2') });
  assert.equal(refused.rows[0].reason_code, 'vba.signature');
  assert.ok(refused.bytes === null);
  const done = await executeFile(wb, modulePlan(['Module2'], 'add'), { now: NOW, recipe: moduleAddRecipe('Module2'), acknowledgeSignature: true });
  assert.equal(done.rows[0].verdict, 'changed');
  assert.equal(done.rows[0].signature_removed, true);
  assert.equal((await openWorkbook(done.bytes, 'x.xlsm')).vba.signed, false);
});

test('F2-07: a locked, unwritable or unreadable project is refused for an add and for a remove', async () => {
  const cases = [
    [(wb) => { wb.vba.project.writable = false; wb.vba.project.locked = true; }, 'vba.locked'],
    [(wb) => { wb.vba.project.writable = false; }, 'vba.write'],
    [(wb) => { wb.vba = { ...wb.vba, project: null, error: 'vba.dir' }; }, 'vba.dir']
  ];
  for (const [tamper, code] of cases) {
    const a = await openMixed();
    tamper(a);
    const add = await executeFile(a, modulePlan(['Module2'], 'add'), { now: NOW, recipe: moduleAddRecipe('Module2') });
    assert.equal(add.rows[0].reason_code, code);
    const b = await openMixed();
    tamper(b);
    const remove = await executeFile(b, modulePlan(['Module1'], 'remove'), { now: NOW, recipe: moduleRemoveRecipe('Module1') });
    assert.equal(remove.rows[0].reason_code, code);
    assert.ok(add.bytes === null && remove.bytes === null);
  }
});

test('F2-07: a remove action takes out a standard module and reports its index hash', async () => {
  const wb = await openMixed();
  const full = moduleOf(wb, 'Module1').text;
  const res = await executeFile(wb, modulePlan(['Module1'], 'remove'), { now: NOW, recipe: moduleRemoveRecipe('Module1') });
  const back = await openWorkbook(res.bytes, 'x.xlsm');
  assert.deepEqual(back.vba.project.modules.map((m) => m.name), ['ThisWorkbook', 'Sheet1']);
  assert.deepEqual(res.changes, [{ op: 'remove', target: { type: 'module', name: 'Module1' }, oldHash: await sha256Text(full), newHash: null }]);
  const row = res.rows[0];
  assert.equal(row.action, 'remove');
  assert.equal(row.verdict, 'changed');
  assert.equal(row.old_hash, (await indexed(generated('mixed.xlsm'), 'mixed.xlsm')).modules.find((m) => m.name === 'Module1').hash);
  assert.equal(row.new_hash, '');
  assert.equal(row.verified, true);
});

test('F2-07: a sheet or workbook module cannot be removed and the reason names its kind', async () => {
  const wb = await openMixed();
  for (const name of ['ThisWorkbook', 'Sheet1']) {
    const res = await executeFile(wb, modulePlan([name], 'remove'), { now: NOW, recipe: moduleRemoveRecipe(name) });
    assert.ok(res.bytes === null);
    assert.equal(res.rows[0].verdict, 'refused');
    assert.equal(res.rows[0].reason_code, 'refused.moduleKind');
    assert.equal(res.rows[0].reason, 'document');
    assert.equal(res.rows[0].old_hash, await sha256Text(moduleOf(wb, name).text));
  }
});

test('F2-07: a remove of a module the file does not have, or from a file with no macros, is skipped', async () => {
  const wb = await openMixed();
  const missing = await executeFile(wb, modulePlan(['Nope'], 'remove'), { now: NOW, recipe: moduleRemoveRecipe('Nope') });
  assert.equal(missing.rows[0].verdict, 'skipped');
  assert.equal(missing.rows[0].reason_code, 'skip.notApplicable');
  const none = await executeFile(await open(), modulePlan(['Module1'], 'remove'), { now: NOW, recipe: moduleRemoveRecipe('Module1') });
  assert.equal(none.rows[0].verdict, 'skipped');
});

test('F2-07: removing a module in a signed project is refused until acknowledged', async () => {
  const wb = await openWorkbook(generated('signed.xlsm'), 'signed.xlsm');
  const refused = await executeFile(wb, modulePlan(['Module1'], 'remove'), { now: NOW, recipe: moduleRemoveRecipe('Module1') });
  assert.equal(refused.rows[0].reason_code, 'vba.signature');
  const done = await executeFile(wb, modulePlan(['Module1'], 'remove'), { now: NOW, recipe: moduleRemoveRecipe('Module1'), acknowledgeSignature: true });
  assert.equal(done.rows[0].signature_removed, true);
});

test('F2-07: the same now gives the same bytes for a module add, even when the clock moves', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 14, 10, 0, 0) });
  const wb = await openMixed();
  const a = await executeFile(wb, modulePlan(['Module2'], 'add'), { now: NOW, recipe: moduleAddRecipe('Module2') });
  t.mock.timers.tick(30000);
  const b = await executeFile(wb, modulePlan(['Module2'], 'add'), { now: NOW, recipe: moduleAddRecipe('Module2') });
  assert.equal(a.sha256, b.sha256);
});
