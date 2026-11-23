import test from 'node:test';
import assert from 'node:assert/strict';
import { Package } from '../../src/core/opc.js';
import { readZip } from '../../src/core/zip-read.js';
import { openWorkbook } from '../../src/core/workbook.js';
import { sha256Bytes } from '../../src/batch/index/hash.js';
import { makePack } from '../../scripts/make-excel-pack.mjs';
import { startPlanRun } from '../../src/app/plan-run.js';
import { buildPlanOutput } from '../../src/app/outputs.js';
import { SetSession } from '../../src/app/set-session.js';
import { indexWorkbook } from '../../src/batch/index/file-index.js';
import { runFilePlan } from '../../src/batch/execute/run-file.js';
import { appliedMessage } from '../../src/batch/protocol.js';
import { parseRecipe } from '../../src/batch/recipe/recipe.js';
import { fixture } from './helpers.js';

let pack;
const built = async () => {
  if (!pack) {
    const made = await makePack();
    const zip = new Package(readZip(made.bytes));
    const files = new Map();
    for (const name of zip.names()) files.set(name, await zip.bytes(name));
    pack = { made, files };
  }
  return pack;
};

test('the pack has a checklist first and an input and an output folder for every case', async () => {
  const { made, files } = await built();
  assert.equal(made.cases, 13);
  assert.equal(files.has('CHECKLIST.md'), true);
  const folders = new Set([...files.keys()].filter((n) => n.startsWith('cases/')).map((n) => n.split('/')[1]));
  assert.equal(folders.size, 13);
  for (const f of folders) {
    assert.ok([...files.keys()].some((n) => n.startsWith(`cases/${f}/input/`)), f);
    assert.ok([...files.keys()].some((n) => n.startsWith(`cases/${f}/output/`)), f);
  }
});

test('every output opens with Quoin and appears in the checklist with its SHA-256', async () => {
  const { files } = await built();
  const list = new TextDecoder().decode(files.get('CHECKLIST.md'));
  const outputs = [...files.keys()].filter((n) => n.includes('/output/'));
  assert.equal(outputs.length, 17);
  for (const name of outputs) {
    const wb = await openWorkbook(files.get(name), name.split('/').pop());
    assert.ok(wb.sheets.length > 0, name);
    assert.ok(list.includes(`${await sha256Bytes(files.get(name))}  ${name}`), name);
  }
});

test('the checklist lists every case, marks nothing as verified, and tells the person how to report', async () => {
  const { files } = await built();
  const list = new TextDecoder().decode(files.get('CHECKLIST.md'));
  assert.equal((list.match(/^## \d\d /gm) || []).length, 13);
  assert.equal((list.match(/^- \[ \] pass$/gm) || []).length, 13);
  assert.equal((list.match(/^- \[ \] fail\./gm) || []).length, 13);
  assert.equal(/\[x\]/i.test(list), false);
  assert.match(list, /Nothing here is marked verified until you say so\./);
  assert.match(list, /repair or recovery message on opening is a fail/);
});

test('making the pack twice gives the same bytes', async () => {
  const { made } = await built();
  const again = await makePack();
  assert.equal(await sha256Bytes(again.bytes), await sha256Bytes(made.bytes));
});

test('the new-file outputs in the pack are byte for byte what the app writes for the same set and time', async () => {
  const { files } = await built();
  const bytes = fixture('pq_simple.xlsx');
  const session = new SetSession();
  session.addFiles([{ name: 'pq_simple.xlsx', relPath: 'pq_simple.xlsx', size: bytes.length, lastModified: 1, file: new Blob([bytes]) }]);
  const f = session.list()[0];
  session.indexed(f.id, await indexWorkbook(bytes, { id: f.id, name: f.name, relPath: f.relPath, size: f.size }));
  const pool = {
    async submit({ message }) {
      const meta = { id: f.id, name: f.name, relPath: f.relPath, size: f.size };
      return { status: 'done', message: appliedMessage(f.id, await runFilePlan(bytes, meta, message.filePlan, message.options)) };
    },
    cancel() {}
  };
  const recipe = parseRecipe(JSON.stringify({ recipe: 'transform', v: 1, scope: { type: 'tables', match: 'all' }, query: { source: 'inline', m: 'Excel.CurrentWorkbook(){[Name="{unit.name}"]}[Content]' }, output: { mode: 'newFile' } })).recipe;
  const now = '2026-11-23T12:00:00.000Z';
  const previewed = await startPlanRun({ session, pool, recipe, now, runId: 'p', mode: 'preview' }).promise;
  const ran = await startPlanRun({ session, pool, recipe, now, runId: 'g', mode: 'run', preview: previewed, build: (r) => buildPlanOutput(r) }).promise;
  const written = [...ran.perFile.values()].flatMap((held) => held.outputs);
  const inPack = [...files.keys()].filter((n) => n.startsWith('cases/') && n.includes('-new-file/output/'));
  assert.equal(inPack.length, 2);
  assert.equal(written.length, 2);
  for (const o of written) assert.deepEqual(Array.from(files.get(inPack.find((n) => n.endsWith(`/${o.name}`)))), Array.from(o.bytes), o.name);
});

