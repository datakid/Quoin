import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openWorkbook } from '../../src/core/workbook.js';
import { readUsedGrid } from '../../src/core/cells.js';
import { runOnce } from '../../src/core/m/engine.js';
import { buildBindingWorkbook } from '../../src/core/snapshot.js';
import { expectedGrid, sameGrid } from '../../src/core/sheet/grid.js';
import { indexWorkbook } from '../../src/batch/index/file-index.js';
import { parseRecipe } from '../../src/batch/recipe/recipe.js';
import { resolvePlan } from '../../src/batch/resolve/resolve.js';
import { executeFile } from '../../src/batch/execute/index.js';
import { combineOutputs } from '../../src/batch/execute/combine.js';
import { root } from './helpers.js';

const NOW = '2026-11-14T10:00:00.000Z';
const CLOCK = new Date(NOW);
const CURRENT = 'Excel.CurrentWorkbook(){[Name="{unit.name}"]}[Content]';
const MODES = ['newFile', 'newSheet', 'combined'];
const SCOPES = [['tables', { type: 'tables', match: 'all' }], ['sheets', { type: 'sheets', match: 'all' }]];
const REFUSED_VERDICTS = new Set(['skipped', 'refused', 'failed', 'not-released']);

const recipeOf = (m, scope, output, extra = {}) => parseRecipe(JSON.stringify({ recipe: 'transform', v: 1, scope, query: { source: 'inline', m }, output, ...extra })).recipe;
const tableOf = (m) => runOnce({ sectionText: `section Section1;\r\n\r\nshared Result =\r\n${m};`, queryName: 'Result', now: NOW, previewRows: 1 }).value;
const outputFor = (mode) => (mode === 'combined' ? { mode, name: '{unit.name}' } : { mode });

async function corpus() {
  const files = [];
  for (const dir of ['external', 'workbooks']) {
    const base = join(root, 'tests', 'fixtures', dir);
    for (const name of readdirSync(base).sort()) {
      if (!/\.(xlsx|xlsm)$/i.test(name)) continue;
      const bytes = new Uint8Array(readFileSync(join(base, name)));
      const relPath = `${dir}/${name}`;
      try {
        const wb = await openWorkbook(bytes, name);
        const index = await indexWorkbook(bytes, { id: `${dir}-${name}`, name, relPath, size: bytes.length });
        files.push({ name, relPath, bytes, wb, index, binding: await buildBindingWorkbook(wb) });
      } catch (error) {
        files.push({ name, relPath, bytes, refused: error.code || String(error.message) });
      }
    }
  }
  return files;
}

const expectedOf = (binding, unit) => {
  const item = binding.items.find((i) => i.name === unit.name && i.kind === (unit.kind === 'table' ? 'Table' : 'Sheet'));
  return [item.columns.map((c) => ({ t: 's', v: c })), ...item.rows];
};

const unitsIn = (units) => units.filter((u) => u.kind === 'table' || u.kind === 'sheet');

async function runUnits(file, recipe, id) {
  const plan = resolvePlan(recipe, [file.index], { now: NOW });
  const filePlan = plan.files[0];
  if (!filePlan || !filePlan.actions.length) return null;
  const result = await executeFile(file.wb, filePlan, { now: NOW, recipe, meta: file.index, runId: id });
  return { plan, filePlan, result };
}

function assertRows(result, filePlan, named = true) {
  assert.equal(result.rows.length, filePlan.actions.length, 'one row per planned unit');
  for (const row of result.rows) {
    if (row.verdict === 'changed') {
      assert.equal(row.verified, true, `${row.file} ${row.unit}`);
      if (named) assert.notEqual(row.output, '');
    } else {
      assert.ok(REFUSED_VERDICTS.has(row.verdict), `${row.file} ${row.unit}: ${row.verdict}`);
      assert.equal(row.output, '', `${row.file} ${row.unit} has an output name but verdict ${row.verdict}`);
      assert.equal(row.verified, false);
    }
  }
}

const within = (name) => name.length <= 31 && !/[:\\/?*[\]\u0000-\u001f]/.test(name);

async function checkNewFile(file, result, binding) {
  const changed = result.rows.filter((r) => r.verdict === 'changed');
  assert.equal(result.outputs.length, changed.length);
  assert.equal(new Set(result.outputs.map((o) => o.name.toLowerCase())).size, result.outputs.length, `${file.name}: output names are unique`);
  for (const o of result.outputs) {
    const back = await openWorkbook(o.bytes, o.name);
    assert.deepEqual(back.sheets.map((s) => s.name), ['Result']);
    assert.ok(sameGrid(expectedOf(binding, o.unit), await readUsedGrid(back, 'Result')), `${file.name} ${o.unit.name}: cells differ from the source`);
  }
}

async function checkNewSheet(file, result, binding) {
  const changed = result.rows.filter((r) => r.verdict === 'changed');
  if (!changed.length) {
    assert.deepEqual(result.outputs, []);
    return;
  }
  assert.equal(result.outputs.length, 1);
  const back = await openWorkbook(result.outputs[0].bytes, result.outputs[0].name);
  const names = back.sheets.map((s) => s.name);
  const before = file.wb.sheets.map((s) => s.name);
  assert.deepEqual(names.slice(0, before.length), before);
  const added = names.slice(before.length);
  assert.equal(added.length, changed.length);
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length, `${file.name}: sheet names are unique`);
  assert.ok(added.every(within), `${file.name}: ${added.join(', ')}`);
  const units = result.rows.filter((r) => r.verdict === 'changed');
  for (let i = 0; i < added.length; i++) {
    const unit = unitsIn(file.filePlanUnits).find((u) => u.name === units[i].unit && u.index === units[i].unit_index);
    assert.ok(sameGrid(expectedOf(binding, unit), await readUsedGrid(back, added[i])), `${file.name} ${added[i]}: cells differ from the source`);
  }
}

const pairs = { run: 0, byMode: {}, verdicts: {} };

test('every workbook of the corpus opens or is refused with a code, and the readable ones have units', async () => {
  const files = await corpus();
  const refused = files.filter((f) => f.refused).map((f) => f.name);
  assert.deepEqual(refused, ['encrypted.xlsx']);
  assert.ok(files.length >= 14);
  assert.ok(files.filter((f) => !f.refused).every((f) => f.binding.items.length > 0));
});

for (const [scopeName, scope] of SCOPES) {
  for (const mode of ['newFile', 'newSheet']) {
    test(`transform over the corpus: ${scopeName} scope, ${mode}`, async () => {
      const files = (await corpus()).filter((f) => !f.refused);
      let ran = 0;
      for (const file of files) {
        const recipe = recipeOf(CURRENT, scope, outputFor(mode));
        const out = await runUnits(file, recipe, 'r');
        if (!out) continue;
        ran++;
        assertRows(out.result, out.filePlan);
        file.filePlanUnits = out.filePlan.units;
        if (mode === 'newFile') await checkNewFile(file, out.result, file.binding);
        else await checkNewSheet(file, out.result, file.binding);
        for (const row of out.result.rows) pairs.verdicts[row.verdict] = (pairs.verdicts[row.verdict] || 0) + 1;
      }
      pairs.run += ran;
      pairs.byMode[`${scopeName}/${mode}`] = ran;
      assert.ok(ran >= 10, `only ${ran} files had units`);
    });
  }

  test(`transform over the corpus: ${scopeName} scope, combined into one workbook for the whole run`, async () => {
    const files = (await corpus()).filter((f) => !f.refused);
    const recipe = recipeOf(CURRENT, scope, outputFor('combined'));
    const results = [];
    const expected = [];
    for (const file of files) {
      const out = await runUnits(file, recipe, 'r');
      if (!out) continue;
      assertRows(out.result, out.filePlan, false);
      assert.deepEqual([out.result.outputs, out.result.bytes], [[], null]);
      results.push(out.result);
      for (const part of out.result.sheetParts) expected.push({ file, unit: part.unit });
    }
    const combined = await combineOutputs(results, { now: CLOCK });
    assert.ok(expected.length > 0);
    const back = await openWorkbook(combined.bytes, 'Combined.xlsx');
    const names = back.sheets.map((s) => s.name);
    assert.equal(names.length, expected.length);
    assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length);
    assert.ok(names.every(within), names.filter((n) => !within(n)).join(', '));
    assert.deepEqual(combined.sheetNames, names);
    for (let i = 0; i < names.length; i++) assert.ok(sameGrid(expectedOf(expected[i].file.binding, expected[i].unit), await readUsedGrid(back, names[i])), `${names[i]}: cells differ from the source`);
    const rows = combined.results.flatMap((r) => r.rows);
    assert.ok(rows.filter((r) => r.verdict === 'changed').every((r) => r.verified && r.new_hash === combined.sha256));
    assert.ok(rows.filter((r) => r.verdict !== 'changed').every((r) => r.output === ''));
  });
}

const HOST = 'external/pq_simple.xlsx';
const serialOf = (y, mo, d) => (Date.UTC(y, mo - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;

const TYPED = '#table({"D", "DT", "T", "Dur", "Pct", "Big", "Small", "Flag", "Nothing", "Inf"}, {{#date(2026, 11, 14), #datetime(2026, 11, 14, 10, 30, 0), #time(10, 30, 0), #duration(1, 2, 3, 4), 0.125, 123456789012345, 0.0000001, true, null, 1 / 0}, {#date(1900, 3, 1), #datetime(1904, 1, 1, 0, 0, 0), #time(0, 0, 0), #duration(0, 0, 0, 0), 1, -5, 1e-300, false, null, -1 / 0}})';
const AWKWARD_TEXT = '#table({"A"}, {{"  padded  "}, {"line one#(lf)line two"}, {"a & b < c > d "" e"}, {"emoji \u{1F600} and caf\u00e9"}, {"tab#(tab)inside"}, {""}})';
const EMPTY = '#table({"A", "B"}, {})';
const LONG_OK = `#table({"A"}, {{Text.Repeat("x", 32767)}})`;
const LONG_OVER = `#table({"A"}, {{Text.Repeat("x", 32768)}})`;
const WIDE_OK = '#table(List.Transform(List.Numbers(1, 16384), each "C" & Text.From(_)), {List.Repeat({1}, 16384)})';
const WIDE_OVER = '#table(List.Transform(List.Numbers(1, 16385), each "C" & Text.From(_)), {List.Repeat({1}, 16385)})';
const TALL_OVER = 'Table.FromColumns({List.Numbers(1, 1048577)}, {"A"})';

const hostRecipe = (m, mode, extra = {}, name = null) => recipeOf(m, { type: 'tables', match: 'all' }, name ? { ...outputFor(mode), name } : outputFor(mode), { overrides: [{ file: HOST, path: HOST, units: ['StudentNames'] }], ...extra });

async function runHost(m, mode, extra, name) {
  const file = (await corpus()).find((f) => f.relPath === HOST);
  const recipe = hostRecipe(m, mode, extra, name);
  const out = await runUnits(file, recipe, 'r');
  let bytes = null;
  let sheet = 'Result';
  if (mode === 'newFile') bytes = out.result.outputs[0] ? out.result.outputs[0].bytes : null;
  else if (mode === 'newSheet') {
    bytes = out.result.outputs[0] ? out.result.outputs[0].bytes : null;
    sheet = bytes ? (await openWorkbook(bytes, 'x.xlsx')).sheets.at(-1).name : null;
  } else {
    const combined = await combineOutputs([out.result], { now: CLOCK });
    bytes = combined.bytes;
    sheet = combined.sheetNames && combined.sheetNames[0];
    out.combined = combined;
  }
  return { ...out, bytes, sheet, file };
}

const gridBack = async (bytes, sheet) => readUsedGrid(await openWorkbook(bytes, 'x.xlsx'), sheet);

for (const mode of MODES) {
  test(`generated tables, ${mode}: dates, times, durations, percentages, big and small numbers, booleans and infinity read back as written`, async () => {
    const r = await runHost(TYPED, mode);
    assert.deepEqual(r.result.rows.map((x) => [x.verdict, x.verified]), [['changed', true]]);
    const grid = await gridBack(r.bytes, r.sheet);
    assert.ok(sameGrid(expectedGrid(tableOf(TYPED), 'en-US'), grid));
    assert.deepEqual([grid[1][0].v, grid[1][1].v, grid[1][2].v, grid[1][4].v], [serialOf(2026, 11, 14), serialOf(2026, 11, 14) + 10.5 / 24, 10.5 / 24, 0.125]);
    assert.ok(Math.abs(grid[1][3].v - (1 + (2 * 3600 + 3 * 60 + 4) / 86400)) < 1e-12);
    assert.deepEqual(grid[2].slice(0, 3).map((c) => c.v), [serialOf(1900, 3, 1), serialOf(1904, 1, 1), 0]);
    assert.deepEqual([grid[1][5].v, grid[1][6].v, grid[2][5].v, grid[2][6].v], [123456789012345, 0.0000001, -5, 1e-300]);
    assert.deepEqual([grid[1][9].t, grid[2][9].t], ['e', 'e']);
  });

  test(`generated tables, ${mode}: text with padding, line breaks, markup characters, emoji and an empty string reads back as written`, async () => {
    const r = await runHost(AWKWARD_TEXT, mode);
    assert.equal(r.result.rows[0].verdict, 'changed');
    const grid = await gridBack(r.bytes, r.sheet);
    assert.deepEqual(grid.slice(1, 5).map((row) => row[0].v), ['  padded  ', 'line one\nline two', 'a & b < c > d " e', 'emoji \u{1F600} and caf\u00e9']);
    assert.ok(sameGrid(expectedGrid(tableOf(AWKWARD_TEXT), 'en-US'), grid));
    const back = await openWorkbook(r.bytes, 'x.xlsx');
    const part = back.sheets.find((x) => x.name === r.sheet).part;
    assert.match((await back.pkg.text(part)).text, /<t xml:space="preserve">  padded  <\/t>/);
  });

  test(`generated tables, ${mode}: an empty table is a header row and nothing else`, async () => {
    const r = await runHost(EMPTY, mode);
    assert.deepEqual(r.result.rows.map((x) => [x.verdict, x.verified]), [['changed', true]]);
    assert.deepEqual(await gridBack(r.bytes, r.sheet), [[{ t: 's', v: 'A' }, { t: 's', v: 'B' }]]);
  });

  test(`generated tables, ${mode}: a cell of 32767 characters is written and one of 32768 is refused with nothing released`, async () => {
    const ok = await runHost(LONG_OK, mode);
    assert.equal(ok.result.rows[0].verdict, 'changed');
    assert.equal((await gridBack(ok.bytes, ok.sheet))[1][0].v.length, 32767);
    const over = await runHost(LONG_OVER, mode);
    assert.deepEqual(over.result.rows.map((x) => [x.verdict, x.reason_code, x.verified, x.output]), [['refused', 'refused.cellTooLong', false, '']]);
    assert.equal(over.bytes, null);
  });

  test(`generated tables, ${mode}: 16384 columns are written and 16385 are refused with nothing released`, async () => {
    const ok = await runHost(WIDE_OK, mode);
    assert.equal(ok.result.rows[0].verdict, 'changed');
    assert.equal((await gridBack(ok.bytes, ok.sheet))[0].length, 16384);
    const over = await runHost(WIDE_OVER, mode);
    assert.deepEqual(over.result.rows.map((x) => [x.verdict, x.reason_code, x.verified, x.output]), [['refused', 'refused.tooLarge', false, '']]);
    assert.equal(over.bytes, null);
  });

  test(`generated tables, ${mode}: a table of 1048577 rows is refused and nothing is released`, async () => {
    const over = await runHost(TALL_OVER, mode, { more: { limits: { maxRows: 2000000 } } });
    assert.deepEqual(over.result.rows.map((x) => [x.verdict, x.reason_code, x.verified, x.output]), [['refused', 'refused.tooLarge', false, '']]);
    assert.equal(over.bytes, null);
  });
}

for (const mode of ['newFile', 'newSheet']) {
  test(`transform over the corpus: a pin to the last table of each file, ${mode}, writes that unit alone`, async () => {
    let ran = 0;
    for (const file of (await corpus()).filter((f) => !f.refused)) {
      const tables = file.binding.items.filter((i) => i.kind === 'Table');
      if (!tables.length) continue;
      const last = tables.at(-1).name;
      const recipe = recipeOf(CURRENT, { type: 'tables', match: 'all' }, outputFor(mode), { overrides: [{ file: file.relPath, path: file.relPath, units: [last] }] });
      const out = await runUnits(file, recipe, 'r');
      assert.equal(out.filePlan.source, 'pin');
      assert.deepEqual(out.result.rows.map((r) => [r.unit, r.verdict, r.verified]), [[last, 'changed', true]]);
      file.filePlanUnits = out.filePlan.units;
      if (mode === 'newFile') await checkNewFile(file, out.result, file.binding);
      else await checkNewSheet(file, out.result, file.binding);
      ran++;
    }
    assert.ok(ran >= 8);
  });
}

for (const mode of ['newSheet', 'combined']) {
  test(`generated tables, ${mode}: an output name of 40 emoji makes a sheet name of at most 31 UTF-16 units`, async () => {
    const r = await runHost(EMPTY, mode, {}, '\u{1F600}'.repeat(40));
    assert.equal(r.result.rows[0].verdict, 'changed');
    assert.equal(r.sheet, '\u{1F600}'.repeat(15));
    assert.equal(r.sheet.length, 30);
  });
}
