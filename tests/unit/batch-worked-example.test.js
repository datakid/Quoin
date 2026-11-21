import test from 'node:test';
import assert from 'node:assert/strict';
import { openWorkbook } from '../../src/core/workbook.js';
import { readUsedGrid } from '../../src/core/cells.js';
import { runOnce } from '../../src/core/m/engine.js';
import { workbookFromSheets, STANDARD_STYLES } from '../../src/core/export/xlsx.js';
import { sheetXml } from '../../src/core/sheet/sheet-xml.js';
import { indexWorkbook } from '../../src/batch/index/file-index.js';
import { sha256Bytes } from '../../src/batch/index/hash.js';
import { parseRecipe } from '../../src/batch/recipe/recipe.js';
import { resolvePlan } from '../../src/batch/resolve/resolve.js';
import { executeFile } from '../../src/batch/execute/index.js';

const NOW = '2026-11-14T10:00:00.000Z';
const tableOf = (m) => runOnce({ sectionText: `section Section1;\r\n\r\nshared Result =\r\n${m};`, queryName: 'Result', now: NOW, previewRows: 1 }).value;
const SALES = '#table({"Item", "Qty"}, {{"a", 1}, {"b", null}, {"c", 3}})';
const MORE = '#table({"Item", "Qty"}, {{"x", 7}, {"y", 8}})';

async function book(sheets) {
  return workbookFromSheets(sheets.map(([name, m]) => ({ name, xml: sheetXml(tableOf(m), 'en-US', STANDARD_STYLES) })), { now: new Date(NOW) });
}

const CLEAN_SALES = 'let Raw = Excel.CurrentWorkbook(){[Name="{unit.name}"]}[Content], Promoted = Table.PromoteHeaders(Raw), Clean = Table.SelectRows(Promoted, each [Qty] <> null) in Clean';

async function twelve() {
  const files = [];
  for (let i = 1; i <= 7; i++) files.push({ name: `region${i}.xlsx`, relPath: `east/region${i}.xlsx`, bytes: await book([['Data', SALES], ['Notes', MORE]]) });
  for (let i = 1; i <= 3; i++) files.push({ name: `branch${i}.xlsx`, relPath: `west/branch${i}.xlsx`, bytes: await book([['Data', SALES], ['Extra', MORE]]) });
  files.push({ name: 'old1.xls', relPath: 'legacy/old1.xls', bytes: new Uint8Array([1, 2, 3]) }, { name: 'old2.xls', relPath: 'legacy/old2.xls', bytes: new Uint8Array([4, 5, 6]) });
  return files;
}

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

test('running the ten files gives ten workbooks and thirteen rows, each verified, with the originals untouched', async () => {
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
  assert.deepEqual([...new Set(rows.map((x) => x.verdict))], ['changed']);
  assert.equal(rows.every((x) => x.verified === true && x.compute === 'quoin' && x.action === 'transform'), true);
  assert.deepEqual(await Promise.all(files.map((f) => sha256Bytes(f.bytes))), before);
  for (const { file, result } of outputs) {
    const back = await openWorkbook(result.outputs[0].bytes, file.name);
    const original = await openWorkbook(file.bytes, file.name);
    const added = back.sheets.map((s) => s.name).slice(original.sheets.length);
    assert.deepEqual(added, file.name.startsWith('region') ? ['Clean'] : ['Clean', 'Clean-2']);
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
