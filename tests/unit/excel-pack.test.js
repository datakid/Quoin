import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip } from '../../src/core/zip-read.js';
import { openWorkbook } from '../../src/core/workbook.js';
import { parseRecipe } from '../../src/batch/recipe/recipe.js';
import { executeFile } from '../../src/batch/execute/index.js';
import { sha256Bytes } from '../../src/batch/index/hash.js';
import { buildExcelPack, checklistMarkdown, PACK_NOW } from '../../scripts/make-excel-pack.mjs';

const pack = await buildExcelPack();
const byId = new Map(pack.cases.map((c) => [c.id, c]));
const fixture = (name) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../fixtures/external/${name}`, import.meta.url))));
const open = (file, name) => openWorkbook(file.bytes, name || file.name);
const IDS = ['M01', 'M02', 'M03', 'M04', 'M05', 'M06', 'M07', 'M08', 'Q01', 'Q02', 'Q03', 'Q04', 'Q05', 'Q06', 'T01', 'T02', 'T03', 'T04', 'T05'];

test('excel pack: it has exactly the cases the card names, in order', () => {
  assert.deepEqual(pack.cases.map((c) => c.id), IDS);
});

test('excel pack: the zip is valid and every file in it matches the manifest hash', async () => {
  const zip = readZip(pack.zip);
  const names = zip.entries.map((e) => e.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.every((n) => n.startsWith('quoin-excel-pack/')));
  for (const needed of ['README.md', 'CHECKLIST.md', 'manifest.json']) assert.ok(names.includes(`quoin-excel-pack/${needed}`), needed);
  const manifest = JSON.parse(Buffer.from(await zip.get('quoin-excel-pack/manifest.json').read()).toString('utf8'));
  assert.equal(manifest.cases.length, IDS.length);
  const listed = new Set();
  for (const c of manifest.cases) {
    for (const f of c.files) {
      listed.add(`quoin-excel-pack/${f.path}`);
      const bytes = await zip.get(`quoin-excel-pack/${f.path}`).read();
      assert.equal(await sha256Bytes(bytes), f.sha256, f.path);
      assert.equal(bytes.length, f.bytes, f.path);
    }
  }
  for (const n of names) if (!/\/(README\.md|CHECKLIST\.md|manifest\.json)$/.test(n)) assert.ok(listed.has(n), `${n} is not in the manifest`);
  assert.equal(Buffer.from(await zip.get('quoin-excel-pack/CHECKLIST.md').read()).toString('utf8'), pack.checklist);
});

test('excel pack: building it twice gives the same zip byte for byte', async () => {
  const again = await buildExcelPack();
  assert.equal(await sha256Bytes(again.zip), await sha256Bytes(pack.zip));
  assert.equal(again.checklist, pack.checklist);
});

test('excel pack: every input and every output opens with our reader and with no warning', async () => {
  for (const c of pack.cases) {
    const inWb = await open(c.input);
    assert.deepEqual(inWb.warnings, [], `${c.id} input`);
    for (const o of c.outputs) assert.deepEqual((await open(o)).warnings, [], `${c.id} ${o.name}`);
  }
});

test('excel pack: inputs are the Excel-made fixtures, except Q04 and Q05 which start from the output of Q02', async () => {
  const same = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
  const expectedFrom = { Q01: 'pq_simple.xlsx', Q02: 'pq_simple.xlsx', Q03: 'pq_simple.xlsx', Q06: 'pq_simple.xlsx', T01: 'pq_simple.xlsx', T02: 'pq_simple.xlsx', T03: 'pq_simple.xlsx', M01: 'xw_macro01.xlsm', M02: 'xw_macro01.xlsm', M03: 'xw_macro01.xlsm', M04: 'xw_macro01.xlsm', M08: 'xw_macro01.xlsm', M05: 'xw_macro04.xlsm', M06: 'xw_macro04.xlsm', M07: 'xw_macro04.xlsm', T05: 'xw_macro04.xlsm', T04: 'pq_vba_complex.xlsm' };
  for (const [id, file] of Object.entries(expectedFrom)) assert.ok(same(byId.get(id).input.bytes, fixture(file)), id);
  assert.ok(same(byId.get('Q04').input.bytes, byId.get('Q02').outputs[0].bytes));
  assert.ok(same(byId.get('Q05').input.bytes, byId.get('Q02').outputs[0].bytes));
});

test('excel pack: every case Quoin ran reports a verified change, and the manual case has no output', () => {
  for (const c of pack.cases) {
    if (c.id === 'M08') {
      assert.deepEqual(c.outputs, []);
      assert.deepEqual(c.rows, []);
      continue;
    }
    assert.ok(c.outputs.length >= 1, c.id);
    assert.ok(c.rows.some((r) => r.verdict === 'changed' && r.verified === true), c.id);
    for (const r of c.rows) assert.ok(r.verdict === 'changed' || r.verdict === 'unchanged', `${c.id} ${r.verdict}`);
  }
});

test('excel pack: what the checklist says Quoin did is what is in the files (queries)', async () => {
  const names = async (id) => (await open(byId.get(id).outputs[0])).queries.map((q) => q.name);
  assert.deepEqual(await names('Q02'), ['StudentResults', 'Student Names Copy']);
  assert.deepEqual(await names('Q03'), ['StudentResults', 'Totals (2026)', 'Résumé 2026', 'a.b', 'q1_2026']);
  assert.deepEqual(await names('Q04'), ['StudentResults']);
  assert.deepEqual(await names('Q05'), ['StudentResults', 'Renamed By Quoin']);
  const q01 = await open(byId.get('Q01').outputs[0]);
  assert.ok(q01.queries[0].original.includes('#"Added Version"') && q01.queries[0].original.includes('"Quoin pack Q01"'));
  assert.equal(q01.queries[0].connection.refreshOnLoad, true);
  const q06 = await open(byId.get('Q06').outputs[0]);
  assert.ok(q06.queries[0].original.includes('DateTime.FixedLocalNow()') && !q06.queries[0].original.includes('DateTime.LocalNow()'));
  const q02 = await open(byId.get('Q02').outputs[0]);
  const added = q02.queries.find((q) => q.name === 'Student Names Copy');
  assert.equal(added.connection, null);
  assert.deepEqual(added.load, { kind: 'connection' });
  const q04 = await open(byId.get('Q04').outputs[0]);
  const q04In = await open(byId.get('Q04').input);
  assert.equal(q04.mashup.section.text, (await open({ bytes: fixture('pq_simple.xlsx'), name: 'x.xlsx' })).mashup.section.text);
  assert.ok(q04In.mashup.section.text.includes('Student Names Copy'));
});

test('excel pack: what the checklist says Quoin did is what is in the files (macros and signatures)', async () => {
  const mods = async (id) => (await open(byId.get(id).outputs[0])).vba.project.modules.map((m) => m.name);
  assert.deepEqual(await mods('M01'), ['Module1', 'ThisWorkbook', 'Sheet1']);
  assert.deepEqual(await mods('M02'), ['Module1', 'ThisWorkbook', 'Sheet1', 'Module2']);
  assert.deepEqual(await mods('M03'), ['ThisWorkbook', 'Sheet1']);
  const m01 = await open(byId.get('M01').outputs[0]);
  assert.ok(m01.vba.project.modules[0].model.visible.includes('Macro1 replaced by Quoin'));
  const m02 = await open(byId.get('M02').outputs[0]);
  assert.ok(m02.vba.project.modules.find((m) => m.name === 'Module2').model.visible.includes('Sub QuoinAdded()'));
  const m04 = await open(byId.get('M04').outputs[0]);
  const text = m04.vba.project.modules[0].model.visible;
  assert.ok(text.includes('"456"') && !text.includes('"123"'));
  for (const id of ['M05', 'M06', 'M07']) {
    assert.equal((await open(byId.get(id).input)).vba.signed, true, `${id} input is signed`);
    assert.equal((await open(byId.get(id).outputs[0])).vba.signed, false, `${id} output lost its signature`);
    assert.ok(byId.get(id).rows.every((r) => r.signature_removed === true || r.verdict === 'unchanged'), id);
  }
  assert.equal((await open(byId.get('T05').input)).vba.signed, true);
  const t05 = await open(byId.get('T05').outputs[0]);
  assert.equal(t05.vba.signed, true);
  assert.deepEqual(t05.sheets.map((s) => s.name), ['Foo', 'Result']);
});

test('excel pack: what the checklist says Quoin did is what is in the files (results)', async () => {
  const sheets = async (id, i = 0) => (await open(byId.get(id).outputs[i])).sheets.map((s) => s.name);
  assert.deepEqual(byId.get('T01').outputs.map((o) => o.name), ['pq_simple__StudentNames.xlsx', 'pq_simple__StudentResults.xlsx']);
  assert.deepEqual(await sheets('T01', 0), ['Result']);
  assert.deepEqual(await sheets('T01', 1), ['Result']);
  assert.deepEqual(await sheets('T02'), ['Input', 'StudentResults', 'Result', 'Result-2']);
  assert.deepEqual(await sheets('T03'), ['pq_simple__StudentNames', 'pq_simple__StudentResults']);
  assert.deepEqual(await sheets('T04'), ['Input', 'Result', 'Result-2']);
  for (const id of ['T01', 'T03']) for (const o of byId.get(id).outputs) assert.equal((await open(o)).queries.length, 0, id);
  const t02 = await open(byId.get('T02').outputs[0]);
  assert.deepEqual(t02.queries.map((q) => q.name), ['StudentResults']);
  const t04 = await open(byId.get('T04').outputs[0]);
  const t04In = await open(byId.get('T04').input);
  assert.deepEqual(t04.vba.project.modules.map((m) => [m.name, m.text]), t04In.vba.project.modules.map((m) => [m.name, m.text]));
});

test('excel pack: the protected-project case gives a recipe that Quoin refuses on a locked project and writes nothing', async () => {
  const c = byId.get('M08');
  const recipeFile = c.extra.find((x) => x.name === 'recipe.json');
  const recipe = parseRecipe(Buffer.from(recipeFile.bytes).toString('utf8')).recipe;
  const wb = await open(c.input);
  wb.vba.project.writable = false;
  wb.vba.project.locked = true;
  const unit = { fileId: 'f0001', kind: 'workbook', name: 'protected', index: 1 };
  const plan = { fileId: 'f0001', source: 'rule', units: [unit], actions: [{ unit, op: 'add', target: { type: 'module', name: 'Module2' }, compute: null, output: null, replaces: null }], skipped: null };
  const res = await executeFile(wb, plan, { now: PACK_NOW, recipe });
  assert.ok(res.bytes === null);
  assert.equal(res.rows[0].verdict, 'refused');
  assert.equal(res.rows[0].reason_code, 'vba.locked');
});

test('excel pack: the checklist has one block per case, nothing in it is ticked, and it claims no result', () => {
  assert.equal(pack.checklist, checklistMarkdown(pack.cases));
  assert.ok(!/\[[xX]\]/.test(pack.checklist));
  const blocks = pack.checklist.split(/^### /m).slice(1);
  assert.equal(blocks.length, IDS.length);
  blocks.forEach((block, i) => {
    assert.ok(block.startsWith(IDS[i]), IDS[i]);
    assert.ok((block.match(/^- \[ \] /gm) || []).length >= 4, IDS[i]);
    assert.ok(/^Result: _+ +Notes: _+$/m.test(block), IDS[i]);
    assert.ok(block.includes(`cases/${IDS[i]}-`), IDS[i]);
  });
  assert.ok(!/\b(passed|verified in excel|all good)\b/i.test(pack.checklist.replace('A case passes only when every line is ticked.', '')));
});

test('excel pack: the committed checklist is the one the script makes now', () => {
  const committed = readFileSync(fileURLToPath(new URL('../../docs/fable/excel-pack/CHECKLIST.md', import.meta.url)), 'utf8');
  assert.equal(committed, pack.checklist);
});

test('excel pack: the command line writes the zip and the checklist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'quoin-pack-'));
  const out = execFileSync(process.execPath, [fileURLToPath(new URL('../../scripts/make-excel-pack.mjs', import.meta.url)), '--out', dir], { encoding: 'utf8' });
  assert.match(out, /19 cases, 42 files/);
  assert.ok(existsSync(join(dir, 'quoin-excel-pack.zip')));
  assert.equal(readFileSync(join(dir, 'CHECKLIST.md'), 'utf8'), pack.checklist);
  assert.equal(Buffer.compare(readFileSync(join(dir, 'quoin-excel-pack.zip')), Buffer.from(pack.zip)), 0);
});
