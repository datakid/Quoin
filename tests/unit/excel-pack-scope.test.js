import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScopePack } from '../../scripts/make-excel-pack-scope.mjs';
import { readZip } from '../../src/core/zip-read.js';
import { openWorkbook } from '../../src/core/workbook.js';

test('the second pack has the three cases and the files each one needs', async () => {
  const pack = await buildScopePack();
  assert.deepEqual(pack.cases.map((c) => [c.id, Boolean(c.held)]), [['X01', false], ['X02', false], ['X03', true]]);
  const names = readZip(pack.zip).entries.map((e) => e.name).sort();
  assert.deepEqual(names, ['CHECKLIST-SCOPE.md', 'X01/expected-by-quoin.xlsx', 'X01/input.xlsx', 'X01/output.xlsx', 'X01/what-quoin-reported.json', 'X02/expected-by-quoin.xlsx', 'X02/input.xlsm', 'X02/output.xlsm', 'X02/what-quoin-reported.json', 'X03/input.xlsx', 'X03/output.xlsx', 'X03/what-quoin-reported.json']);
});

test('the pack is the same every time it is built', async () => {
  const a = await buildScopePack();
  const b = await buildScopePack();
  assert.deepEqual(a.zip, b.zip);
  assert.deepEqual(a.cases.map((c) => c.hash), b.cases.map((c) => c.hash));
});

test('the Excel-compute outputs refresh on load and say so in the report, and the in-place output keeps formulas and merged cells', async () => {
  const pack = await buildScopePack();
  const zip = readZip(pack.zip);
  const bytes = async (name) => new Uint8Array(await zip.get(name).read());
  const x01 = await openWorkbook(await bytes('X01/output.xlsx'), 'o.xlsx');
  assert.equal(x01.queries[0].connection.refreshOnLoad, true);
  assert.match(x01.queries[0].original, /Table\.SelectRows/);
  const report = JSON.parse(new TextDecoder().decode(await bytes('X01/what-quoin-reported.json')));
  assert.deepEqual(report.excelOnOpen.map((r) => [r.compute, r.verdict, r.verified]), [['excel', 'changed', true]]);
  assert.deepEqual(report.quoinNow.map((r) => [r.compute, r.verdict, r.verified]), [['quoin', 'changed', true]]);
  const x03 = (await openWorkbook(await bytes('X03/output.xlsx'), 'o.xlsx')).pkg;
  const sheet = (await x03.text('xl/worksheets/sheet1.xml')).text;
  assert.match(sheet, /<f>SUM\(A1:A2\)<\/f>/);
  assert.match(sheet, /<mergeCell ref="B2:C2"\/>/);
});

test('the checklist says nothing was run in Excel and that in place waits for the other two', async () => {
  const { checklist } = await buildScopePack();
  assert.match(checklist, /Nothing here has been run in real Excel/);
  assert.match(checklist, /## X03 \(hold: after X01 and X02\)/);
  assert.equal((checklist.match(/- \[ \]/g) || []).length > 12, true);
});
