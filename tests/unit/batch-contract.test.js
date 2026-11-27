import test from 'node:test';
import assert from 'node:assert/strict';
import { openWorkbook } from '../../src/core/workbook.js';
import { normalizeQueryText } from '../../src/core/pq/section.js';
import { indexWorkbook } from '../../src/batch/index/file-index.js';
import { sha256Text } from '../../src/batch/index/hash.js';
import { parseRecipe } from '../../src/batch/recipe/recipe.js';
import { resolvePlan } from '../../src/batch/resolve/resolve.js';
import { executeFile } from '../../src/batch/execute/index.js';
import { fixture } from './helpers.js';

const NOW = '2026-11-14T10:00:00.000Z';
const NEW_M = 'let Source = 1 in Source';
const NEXT_M = 'let Source = 2 in Source';
const MODULE_TEXT = 'Option Explicit\n\nSub Hello()\nEnd Sub\n';
const MODULE_NEXT = 'Option Explicit\n\nSub Hello()\n  Debug.Print "hi"\nEnd Sub\n';

const recipeOf = (kind, body) => parseRecipe(JSON.stringify({ recipe: kind, v: 1, [kind]: body })).recipe;
const inject = (body) => recipeOf('inject', { source: 'inline', ...body });

async function execute(recipe, bytes, name, extra = {}, siblings = []) {
  const index = await indexWorkbook(bytes, { id: 'f1', name, relPath: name, size: bytes.length });
  const others = [];
  for (const [i, s] of siblings.entries()) others.push(await indexWorkbook(s, { id: `s${i}`, name: `sibling${i}${name.slice(name.lastIndexOf('.'))}`, relPath: `sibling${i}/${name}`, size: s.length }));
  const plan = resolvePlan(recipe, [index, ...others], { now: NOW });
  const result = await executeFile(await openWorkbook(bytes, name), plan.files.find((f) => f.fileId === 'f1'), { now: NOW, recipe, meta: index, runId: 'r1', ...extra });
  return { index, plan, result };
}

async function twice(recipe, bytes, name, extra, siblings) {
  const a = await execute(recipe, bytes, name, extra, siblings);
  assert.deepEqual(a.plan.errors, []);
  const b = await execute(recipe, bytes, name, extra, siblings);
  assert.deepEqual(a.result.bytes, b.result.bytes, 'two runs with the same time give the same bytes');
  const stable = (rows) => rows.map(({ duration_ms: _d, ...rest }) => rest);
  assert.deepEqual(stable(a.result.rows), stable(b.result.rows));
  return a;
}

const verdicts = (result) => result.rows.map((r) => [r.verdict, r.reason_code, r.verified]);
const reindex = (bytes, name) => indexWorkbook(bytes, { id: 'g1', name, relPath: name, size: bytes.length });

test('add a query: a connection-only query appears, verified', async () => {
  const bytes = fixture('pq_simple.xlsx');
  const { result } = await twice(inject({ target: 'query', op: 'add', name: 'Brand New', text: NEW_M }), bytes, 'pq_simple.xlsx');
  assert.deepEqual(verdicts(result), [['changed', '', true]]);
  const back = await openWorkbook(result.bytes, 'out.xlsx');
  const added = back.queries.find((q) => q.name === 'Brand New');
  assert.equal(normalizeQueryText(added.original), NEW_M);
  assert.equal(added.load.kind, 'connection');
  assert.equal(result.rows[0].new_hash, await sha256Text(NEW_M));
});

test('replace a query: the text changes and the old and new hashes are the index hashes', async () => {
  const bytes = fixture('pq_simple.xlsx');
  const { index, result } = await twice(inject({ target: 'query', op: 'replace', name: 'StudentResults', text: NEXT_M }), bytes, 'pq_simple.xlsx');
  assert.deepEqual(verdicts(result), [['changed', '', true]]);
  assert.equal(result.rows[0].old_hash, index.queries.find((q) => q.name === 'StudentResults').hash);
  assert.equal((await reindex(result.bytes, 'out.xlsx')).queries.find((q) => q.name === 'StudentResults').hash, result.rows[0].new_hash);
});

test('rename then remove a query the run added: both verified', async () => {
  const bytes = fixture('pq_simple.xlsx');
  const added = await execute(inject({ target: 'query', op: 'add', name: 'Tmp', text: NEW_M }), bytes, 'pq_simple.xlsx');
  const renamed = await twice(inject({ target: 'query', op: 'rename', name: 'Tmp', newName: 'Tmp2' }), added.result.bytes, 'pq_simple.xlsx');
  assert.deepEqual(verdicts(renamed.result), [['changed', '', true]]);
  assert.deepEqual((await openWorkbook(renamed.result.bytes, 'o.xlsx')).queries.map((q) => q.name).sort(), ['StudentResults', 'Tmp2']);
  const removed = await twice(inject({ target: 'query', op: 'remove', name: 'Tmp2' }), renamed.result.bytes, 'pq_simple.xlsx');
  assert.deepEqual(verdicts(removed.result), [['changed', '', true]]);
  assert.deepEqual((await openWorkbook(removed.result.bytes, 'o.xlsx')).queries.map((q) => q.name), ['StudentResults']);
});

test('rename and remove of a query that is loaded are refused as rows, never written', async () => {
  const bytes = fixture('pq_simple.xlsx');
  const rename = await execute(inject({ target: 'query', op: 'rename', name: 'StudentResults', newName: 'Other' }), bytes, 'pq_simple.xlsx');
  assert.deepEqual(rename.result.rows.map((r) => [r.verdict, r.reason_code]), [['refused', 'refused.renameLoaded']]);
  const remove = await execute(inject({ target: 'query', op: 'remove', name: 'StudentResults' }), bytes, 'pq_simple.xlsx');
  assert.deepEqual(remove.result.rows.map((r) => [r.verdict, r.reason_code]), [['refused', 'refused.loaded']]);
  assert.equal(remove.result.bytes, null);
});

test('add, replace and remove a standard module in a macro workbook: each verified', async () => {
  const bytes = fixture('pq_vba_complex.xlsm');
  const added = await twice(inject({ target: 'module', op: 'add', name: 'Helpers', text: MODULE_TEXT }), bytes, 'pq_vba_complex.xlsm');
  assert.deepEqual(verdicts(added.result), [['changed', '', true]]);
  const mid = await openWorkbook(added.result.bytes, 'o.xlsm');
  assert.deepEqual(mid.vba.project.modules.map((m) => m.name).sort(), ['Helpers', 'Sheet1', 'ThisWorkbook']);
  const replaced = await twice(inject({ target: 'module', op: 'replace', name: 'Helpers', text: MODULE_NEXT }), added.result.bytes, 'pq_vba_complex.xlsm');
  assert.deepEqual(verdicts(replaced.result), [['changed', '', true]]);
  assert.equal((await reindex(replaced.result.bytes, 'o.xlsm')).modules.find((m) => m.name === 'Helpers').hash, replaced.result.rows[0].new_hash);
  const removed = await twice(inject({ target: 'module', op: 'remove', name: 'Helpers' }), replaced.result.bytes, 'pq_vba_complex.xlsm');
  assert.deepEqual(verdicts(removed.result), [['changed', '', true]]);
  assert.deepEqual((await openWorkbook(removed.result.bytes, 'o.xlsm')).vba.project.modules.map((m) => m.name).sort(), ['Sheet1', 'ThisWorkbook']);
});

test('replace a document module, and rename a module is a refused row', async () => {
  const bytes = fixture('pq_vba_complex.xlsm');
  const replaced = await twice(inject({ target: 'module', op: 'replace', name: 'Sheet1', text: MODULE_NEXT }), bytes, 'pq_vba_complex.xlsm');
  assert.deepEqual(verdicts(replaced.result), [['changed', '', true]]);
  const renamed = await execute(inject({ target: 'module', op: 'rename', name: 'Sheet1', newName: 'Other' }), bytes, 'pq_vba_complex.xlsm');
  assert.deepEqual(renamed.result.rows.map((r) => [r.verdict, r.reason_code]), [['refused', 'refused.unsupported']]);
});

test('replace in code reaches queries and modules and every changed member is verified', async () => {
  const bytes = fixture('pq_vba_complex.xlsm');
  const { result } = await twice(recipeOf('replace', { in: ['m', 'vba'], find: 'InputText', with: 'InputValue' }), bytes, 'pq_vba_complex.xlsm');
  const changed = result.rows.filter((r) => r.verdict === 'changed');
  assert.deepEqual(changed.map((r) => r.verified), [true, true]);
  assert.deepEqual(result.rows.filter((r) => r.verdict !== 'changed').map((r) => r.verdict), ['unchanged', 'unchanged', 'unchanged']);
  const back = await openWorkbook(result.bytes, 'o.xlsm');
  assert.equal(back.queries.some((q) => q.original.includes('InputText')), false);
  assert.equal(back.vba.project.modules.some((m) => m.model.visible.includes('InputText')), false);
});

test('align gives the output the recipe hash, and a file that already has it is unchanged', async () => {
  const bytes = fixture('pq_simple.xlsx');
  const original = await openWorkbook(bytes, 'pq_simple.xlsx');
  const chosen = original.queries[0].original;
  const hash = await sha256Text(normalizeQueryText(chosen));
  const drifted = await execute(inject({ target: 'query', op: 'replace', name: 'StudentResults', text: NEXT_M }), bytes, 'pq_simple.xlsx');
  assert.notEqual((await reindex(drifted.result.bytes, 'd.xlsx')).queries.find((q) => q.name === 'StudentResults').hash, hash);
  const recipe = recipeOf('align', { target: 'query', name: 'StudentResults', hash });
  const aligned = await twice(recipe, drifted.result.bytes, 'pq_simple.xlsx', { alignText: chosen }, [bytes]);
  assert.deepEqual(verdicts(aligned.result), [['changed', '', true]]);
  assert.equal((await reindex(aligned.result.bytes, 'a.xlsx')).queries.find((q) => q.name === 'StudentResults').hash, recipe.align.hash);
  const same = await execute(recipe, bytes, 'pq_simple.xlsx', { alignText: chosen }, [bytes]);
  assert.deepEqual(same.result.rows.map((r) => [r.verdict, r.reason_code]), [['unchanged', '']]);
});

test('align a module to the chosen version: the output module hash equals the recipe hash', async () => {
  const bytes = fixture('pq_vba_complex.xlsm');
  const source = await openWorkbook(bytes, 'pq_vba_complex.xlsm');
  const chosen = source.vba.project.modules.find((m) => m.name === 'Sheet1').text;
  const hash = await sha256Text(chosen);
  const drifted = await execute(inject({ target: 'module', op: 'replace', name: 'Sheet1', text: MODULE_NEXT }), bytes, 'pq_vba_complex.xlsm');
  const recipe = recipeOf('align', { target: 'module', name: 'Sheet1', hash });
  const aligned = await twice(recipe, drifted.result.bytes, 'pq_vba_complex.xlsm', { alignText: chosen }, [bytes]);
  assert.deepEqual(verdicts(aligned.result), [['changed', '', true]]);
  assert.equal((await reindex(aligned.result.bytes, 'a.xlsm')).modules.find((m) => m.name === 'Sheet1').hash, hash);
});

test('align with no file holding the chosen version is a planning error, and text that is not it fails every row and writes nothing', async () => {
  const bytes = fixture('pq_simple.xlsx');
  const recipe = recipeOf('align', { target: 'query', name: 'StudentResults', hash: 'a'.repeat(64) });
  const { plan, result } = await execute(recipe, bytes, 'pq_simple.xlsx', { alignText: NEXT_M });
  assert.deepEqual(plan.errors, [{ code: 'align.noSource', detail: 'a'.repeat(64) }]);
  assert.deepEqual(result.rows.map((r) => [r.verdict, r.reason_code]), [['failed', 'align.sourceChanged']]);
  assert.equal(result.bytes, null);
});
