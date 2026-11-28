import test from 'node:test';
import assert from 'node:assert/strict';
import { openWorkbook } from '../../src/core/workbook.js';
import { readUsedGrid } from '../../src/core/cells.js';
import { indexWorkbook } from '../../src/batch/index/file-index.js';
import { sha256Bytes } from '../../src/batch/index/hash.js';
import { parseRecipe } from '../../src/batch/recipe/recipe.js';
import { resolvePlan } from '../../src/batch/resolve/resolve.js';
import { executeFile } from '../../src/batch/execute/index.js';
import { buildWorkedExample, CLEAN_SALES_M } from '../fixtures/generators/worked-example.js';

const NOW = '2026-11-14T10:00:00.000Z';
const twelve = buildWorkedExample;
const CLEAN_SALES = CLEAN_SALES_M;

async function indexAll(files) {
  const indexes = [];
  for (const [i, f] of files.entries()) {
    if (f.name.endsWith('.xls')) {
      indexes.push({ id: `f${i}`, name: f.name, relPath: f.relPath, size: f.bytes.length, status: 'refused', refused: { code: 'file.unsupportedExtension' }, format: null, sheets: [], tables: [], queries: [], modules: [], pq: { editable: false, reason: null }, vba: { present: false, signed: false, locked: false, writable: false }, warnings: [] });
    } else indexes.push(await indexWorkbook(f.bytes, { id: `f${i}`, name: f.name, relPath: f.relPath, size: f.bytes.length }));
  }
  return indexes;
}

const recipe = (pins) => parseRecipe(JSON.stringify({ recipe: 'transform', v: 1, scope: { type: 'sheets', match: 'all' }, query: { source: 'inline', m: CLEAN_SALES }, output: { mode: 'newSheet', name: 'Clean' }, compute: 'quoin', overrides: pins })).recipe;

test('twelve files, two that cannot be opened, seven pinned to Data and three on all their sheets: 13 units across 10 files', async () => {
  const files = await twelve();
  const indexes = await indexAll(files);
  const pins = indexes.filter((ix) => ix.name.startsWith('region')).map((ix) => ({ file: ix.name, path: ix.relPath, units: ['Data'] }));
  assert.equal(pins.length, 7);
  const plan = resolvePlan(recipe(pins), indexes, { now: NOW });
  assert.equal(plan.files.length, 12);
  assert.deepEqual(plan.files.filter((f) => f.skipped).map((f) => [f.fileId, f.skipped.code]), [['f10', 'file.unsupportedExtension'], ['f11', 'file.unsupportedExtension']]);
  assert.deepEqual(plan.summary, { files: 10, units: 13, groups: [{ unitsPerFile: 1, files: 7 }, { unitsPerFile: 2, files: 3 }] });
  assert.deepEqual([plan.errors, plan.orphanPins], [[], []]);
});

test('running the ten files gives ten workbooks and thirteen rows, eleven changed and two skipped for a missing column, with the originals untouched', async () => {
  const files = await twelve();
  const indexes = await indexAll(files);
  const pins = indexes.filter((ix) => ix.name.startsWith('region')).map((ix) => ({ file: ix.name, path: ix.relPath, units: ['Data'] }));
  const r = recipe(pins);
  const plan = resolvePlan(r, indexes, { now: NOW });
  const before = await Promise.all(files.map((f) => sha256Bytes(f.bytes)));
  const outputs = [];
  const rows = [];
  for (const filePlan of plan.files) {
    if (filePlan.skipped) continue;
    const i = Number(filePlan.fileId.slice(1));
    const wb = await openWorkbook(files[i].bytes, files[i].name);
    const result = await executeFile(wb, filePlan, { now: NOW, recipe: r, meta: indexes[i], runId: 'r1' });
    outputs.push({ file: files[i], result });
    rows.push(...result.rows);
  }
  assert.equal(outputs.length, 10);
  assert.equal(rows.length, 13);
  assert.deepEqual([rows.filter((x) => x.verdict === 'changed').length, rows.filter((x) => x.verdict === 'skipped').length], [11, 2]);
  assert.deepEqual(rows.filter((x) => x.verdict === 'skipped').map((x) => [x.file, x.unit, x.reason_code, x.reason]), [['branch1.xlsx', 'Extra', 'skip.missingColumn', "The field 'Qty' of the record wasn't found."], ['branch2.xlsx', 'Extra', 'skip.missingColumn', "The field 'Qty' of the record wasn't found."]]);
  assert.equal(rows.filter((x) => x.verdict === 'changed').every((x) => x.verified === true), true);
  assert.equal(rows.every((x) => x.compute === 'quoin' && x.action === 'transform'), true);
  assert.deepEqual(await Promise.all(files.map((f) => sha256Bytes(f.bytes))), before);
  for (const { file, result } of outputs) {
    const back = await openWorkbook(result.outputs[0].bytes, file.name);
    const original = await openWorkbook(file.bytes, file.name);
    const added = back.sheets.map((s) => s.name).slice(original.sheets.length);
    assert.deepEqual(added, file.name === 'branch3.xlsx' ? ['Clean', 'Clean-2'] : ['Clean']);
    const grid = await readUsedGrid(back, 'Clean');
    assert.deepEqual(grid.map((row) => row.map((c) => c && c.v)), [['Item', 'Qty'], ['a', 1], ['c', 3]]);
    if (added.length === 2) assert.deepEqual((await readUsedGrid(back, 'Clean-2')).map((row) => row.map((c) => c && c.v)), [['Item', 'Qty'], ['x', 7], ['y', 8]]);
  }
});

test('the report names every file once or more and the two that were not opened are skipped with their reason', async () => {
  const files = await twelve();
  const indexes = await indexAll(files);
  const plan = resolvePlan(recipe([]), indexes, { now: NOW });
  const named = plan.files.filter((f) => f.skipped).map((f) => indexes.find((ix) => ix.id === f.fileId).name);
  assert.deepEqual(named, ['old1.xls', 'old2.xls']);
  assert.deepEqual(plan.files.filter((f) => !f.skipped).map((f) => f.units.length), [2, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
});
