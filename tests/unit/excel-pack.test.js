import test from 'node:test';
import assert from 'node:assert/strict';
import { Package } from '../../src/core/opc.js';
import { readZip } from '../../src/core/zip-read.js';
import { openWorkbook } from '../../src/core/workbook.js';
import { sha256Bytes } from '../../src/batch/index/hash.js';
import { makePack } from '../../scripts/make-excel-pack.mjs';

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
  assert.equal(made.cases, 20);
  assert.equal(files.has('CHECKLIST.md'), true);
  const folders = new Set([...files.keys()].filter((n) => n.startsWith('cases/')).map((n) => n.split('/')[1]));
  assert.equal(folders.size, 20);
  for (const f of folders) {
    assert.ok([...files.keys()].some((n) => n.startsWith(`cases/${f}/input/`)), f);
    const manual = [...files.keys()].some((n) => n.startsWith(`cases/${f}/recipe/`)) && ![...files.keys()].some((n) => n.startsWith(`cases/${f}/output/`));
    assert.ok(manual ? f.endsWith('-module-locked-project') : [...files.keys()].some((n) => n.startsWith(`cases/${f}/output/`)), f);
  }
});

test('every output opens with Quoin and appears in the checklist with its SHA-256', async () => {
  const { files } = await built();
  const list = new TextDecoder().decode(files.get('CHECKLIST.md'));
  const outputs = [...files.keys()].filter((n) => n.includes('/output/'));
  assert.equal(outputs.length, 26);
  for (const name of outputs) {
    const wb = await openWorkbook(files.get(name), name.split('/').pop());
    assert.ok(wb.sheets.length > 0, name);
    assert.ok(list.includes(`${await sha256Bytes(files.get(name))}  ${name}`), name);
  }
});

test('the checklist lists every case, marks nothing as verified, and tells the person how to report', async () => {
  const { files } = await built();
  const list = new TextDecoder().decode(files.get('CHECKLIST.md'));
  assert.equal((list.match(/^## \d\d /gm) || []).length, 20);
  assert.equal((list.match(/^- \[ \] pass$/gm) || []).length, 20);
  assert.equal((list.match(/^- \[ \] fail\./gm) || []).length, 20);
  assert.equal(/\[x\]/i.test(list), false);
  assert.match(list, /Nothing here is marked verified until you say so\./);
  assert.match(list, /repair or recovery message on opening is a fail/);
});

test('making the pack twice gives the same bytes', async () => {
  const { made } = await built();
  const again = await makePack();
  assert.equal(await sha256Bytes(again.bytes), await sha256Bytes(made.bytes));
});
