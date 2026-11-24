import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Package } from '../../src/core/opc.js';
import { readZip } from '../../src/core/zip-read.js';
import { openWorkbook } from '../../src/core/workbook.js';
import { parseRecipe } from '../../src/batch/recipe/recipe.js';
import { executeFile } from '../../src/batch/execute/index.js';
import { makePack } from '../../scripts/make-excel-pack.mjs';

let loaded;
async function pack() {
  if (!loaded) {
    const made = await makePack();
    const zip = new Package(readZip(made.bytes));
    const files = new Map();
    for (const name of zip.names()) files.set(name, await zip.bytes(name));
    loaded = { files, checklist: new TextDecoder().decode(files.get('CHECKLIST.md')) };
  }
  return loaded;
}

const fixture = (dir, name) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../fixtures/${dir}/${name}`, import.meta.url))));
const same = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
const folderOf = (files, slug) => [...files.keys()].map((n) => n.split('/')[1]).find((f) => f && f.endsWith(`-${slug}`));
const pathIn = (files, slug, kind, name) => `cases/${folderOf(files, slug)}/${kind}/${name}`;
const openFile = async (files, slug, kind, name) => openWorkbook(files.get(pathIn(files, slug, kind, name)), name);
const block = (checklist, slug) => {
  const parts = checklist.split(/^## /m).slice(1);
  return parts.find((b) => b.includes(`-${slug}/`));
};

test('excel pack claims: every path the checklist names is in the pack', async () => {
  const { files, checklist } = await pack();
  const named = [...checklist.matchAll(/^(?:Input|Open): (.+)$/gm)].flatMap((m) => m[1].split(', ')).filter((p) => p.startsWith('cases/'));
  assert.ok(named.length >= 40);
  for (const path of named) assert.ok(files.has(path), path);
});

test('excel pack claims: every case with an Excel input says to open the input first', async () => {
  const { checklist } = await pack();
  const blocks = checklist.split(/^## /m).slice(1, -1);
  const manual = blocks.filter((b) => b.includes('module-locked-project'));
  assert.equal(manual.length, 1);
  for (const b of blocks.filter((x) => !manual.includes(x))) assert.match(b, /^1\. First open the input file or files of this case/m);
});

test('excel pack claims: inputs are the fixtures, and the remove and rename inputs are the output of the add', async () => {
  const { files } = await pack();
  const inputs = [...files.keys()].filter((n) => n.includes('/input/'));
  for (const path of inputs) {
    const name = path.split('/').pop();
    if (name === 'pq_added.xlsx') continue;
    const candidates = ['external', 'workbooks'].filter((dir) => { try { return same(fixture(dir, name), files.get(path)); } catch { return false; } });
    assert.ok(candidates.length === 1, `${path} is not a fixture`);
  }
  const added = files.get(pathIn(files, 'query-add', 'output', 'output.xlsx'));
  assert.ok(same(files.get(pathIn(files, 'query-remove', 'input', 'pq_added.xlsx')), added));
  assert.ok(same(files.get(pathIn(files, 'query-rename', 'input', 'pq_added.xlsx')), added));
});

test('excel pack claims: every input opens with Quoin and with no warning', async () => {
  const { files } = await pack();
  for (const path of [...files.keys()].filter((n) => n.includes('/input/'))) assert.deepEqual((await openWorkbook(files.get(path), path.split('/').pop())).warnings, [], path);
});

test('excel pack claims: the refresh case flags the connection and the input does not', async () => {
  const { files } = await pack();
  const out = await openFile(files, 'query-replace-refresh', 'output', 'output.xlsx');
  assert.ok(out.queries[0].original.includes('"Added Version"'));
  assert.equal(out.queries[0].connection.refreshOnLoad, true);
  const input = await openFile(files, 'query-replace-refresh', 'input', 'pq_simple.xlsx');
  assert.equal(input.queries[0].connection.refreshOnLoad, false);
});

test('excel pack claims: the awkward-names case has the four names exactly as the checklist writes them', async () => {
  const { files, checklist } = await pack();
  const out = await openFile(files, 'query-add-awkward-names', 'output', 'output.xlsx');
  const names = ['Totals (2026)', 'Résumé 2026', 'a.b', 'q1_2026'];
  assert.deepEqual(out.queries.map((q) => q.name), ['StudentResults', ...names]);
  for (const n of names) assert.equal(out.queries.find((q) => q.name === n).connection, null, n);
  assert.ok(block(checklist, 'query-add-awkward-names').includes(names.join(' | ')));
  assert.deepEqual(out.warnings, []);
});

test('excel pack claims: the checklist never says a table is listed in Queries & Connections', async () => {
  const { files, checklist } = await pack();
  const input = await openFile(files, 'query-replace', 'input', 'pq_simple.xlsx');
  assert.deepEqual(input.queries.map((q) => q.name), ['StudentResults']);
  assert.ok(input.tables.some((t) => t.name === 'StudentNames'));
  for (const line of checklist.split('\n').filter((l) => /Queries & Connections/.test(l))) assert.ok(!/StudentNames/.test(line.replace(/\(StudentNames is a table[^)]*\)/g, '').replace(/table StudentNames/g, '')), line);
});

test('excel pack claims: the Excel-made module case has what each output line says', async () => {
  const { files } = await pack();
  const mods = async (name) => (await openFile(files, 'module-excel-made', 'output', name)).vba.project.modules;
  const replace = await mods('output-replace.xlsm');
  assert.ok(replace.find((m) => m.name === 'Module1').model.visible.includes('Macro1 replaced by Quoin'));
  assert.deepEqual((await mods('output-add.xlsm')).map((m) => m.name), ['Module1', 'ThisWorkbook', 'Sheet1', 'Module2']);
  assert.ok((await mods('output-add.xlsm')).find((m) => m.name === 'Module2').model.visible.includes('quoin_added'));
  assert.deepEqual((await mods('output-remove.xlsm')).map((m) => m.name), ['ThisWorkbook', 'Sheet1']);
});

test('excel pack claims: the signed add and remove cases start signed and end unsigned', async () => {
  const { files } = await pack();
  assert.equal((await openFile(files, 'signed-add-remove', 'input', 'xw_macro04.xlsm')).vba.signed, true);
  const added = await openFile(files, 'signed-add-remove', 'output', 'output-add.xlsm');
  const removed = await openFile(files, 'signed-add-remove', 'output', 'output-remove.xlsm');
  assert.equal(added.vba.signed, false);
  assert.equal(removed.vba.signed, false);
  assert.ok(added.vba.project.modules.some((m) => m.name === 'Module2'));
  assert.ok(!removed.vba.project.modules.some((m) => m.name === 'Module1'));
});

test('excel pack claims: both outputs of a case that names two inputs have their input in the pack', async () => {
  const { files } = await pack();
  assert.ok(files.has(pathIn(files, 'module-add', 'input', 'xw_macro01.xlsm')));
  assert.ok(files.has(pathIn(files, 'signature-removed', 'input', 'xw_macro04.xlsm')));
});

test('excel pack claims: the new sheets in a macro workbook leave its project as it was, and a signed one keeps its signature', async () => {
  const { files } = await pack();
  const input = await openFile(files, 'new-sheet-macro-workbook', 'input', 'pq_vba_complex.xlsm');
  const outName = [...files.keys()].find((n) => n.startsWith(`cases/${folderOf(files, 'new-sheet-macro-workbook')}/output/`)).split('/').pop();
  const out = await openFile(files, 'new-sheet-macro-workbook', 'output', outName);
  assert.deepEqual(out.vba.project.modules.map((m) => [m.name, m.text]), input.vba.project.modules.map((m) => [m.name, m.text]));
  assert.ok(out.sheets.length > input.sheets.length);
  assert.deepEqual(out.warnings, []);
  const signed = await openFile(files, 'new-sheet-signed-workbook', 'output', 'output.xlsm');
  assert.equal(signed.vba.signed, true);
  assert.deepEqual(signed.sheets.map((s) => s.name), ['Foo', 'Result']);
});

test('excel pack claims: the new-sheet check names the undeclared changes a sheet add could make', async () => {
  const { checklist } = await pack();
  const text = block(checklist, 'new-sheet');
  for (const needle of ['none became hidden', '1904 date system', 'Name Manager', 'Cell Styles', 'displayed format']) assert.ok(text.includes(needle), needle);
});

test('excel pack claims: the locked-project case has a recipe that Quoin refuses on a locked project and no output', async () => {
  const { files } = await pack();
  assert.ok(![...files.keys()].some((n) => n.startsWith(`cases/${folderOf(files, 'module-locked-project')}/output/`)));
  const parsed = parseRecipe(new TextDecoder().decode(files.get(pathIn(files, 'module-locked-project', 'recipe', 'recipe.json'))));
  assert.equal(parsed.ok, true);
  const wb = await openFile(files, 'module-locked-project', 'input', 'xw_macro01.xlsm');
  wb.vba.project.writable = false;
  wb.vba.project.locked = true;
  const unit = { fileId: 'f0001', kind: 'workbook', name: 'protected', index: 1 };
  const plan = { fileId: 'f0001', source: 'rule', units: [unit], actions: [{ unit, op: 'add', target: { type: 'module', name: 'QuoinAdded' }, compute: null, output: null, replaces: null }], skipped: null };
  const res = await executeFile(wb, plan, { now: '2026-11-23T12:00:00.000Z', recipe: parsed.recipe });
  assert.ok(res.bytes === null);
  assert.equal(res.rows[0].reason_code, 'vba.locked');
});
