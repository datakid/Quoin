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

test('the checklist lines the reviewer found wrong now say what the files do', async () => {
  const { checklist } = await buildScopePack();
  assert.match(checklist, /Type 4 in A2 and A3 shows 5 \(A1 is 1\)/);
  assert.equal(checklist.includes('changes to 6'), false);
  assert.match(checklist, /Alt\+F8 lists no macro, in the input as well as the output/);
  assert.match(checklist, /E4 holds 3 and F4 is empty\. The 3 in E4 is a plain value, not a formula/);
});

test('the three outputs have the hashes the reviewer checked', async () => {
  const { cases } = await buildScopePack();
  assert.deepEqual(cases.map((c) => c.hash), ['fc55738c07ef57431bb2de6d57905c3b8deaac151683d3c394b6cf96177405c9', '19f0111eb293a8c03c43b06c642e77d9ac684e99fb7bbb73d76786439a86b244', '9bbd78bcc4db771759b642e563c14bb06d52b7c11a2d9ed2789ab240d8f249ea']);
});
