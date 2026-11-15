import test from 'node:test';
import assert from 'node:assert/strict';
import { openWorkbook } from '../../src/core/workbook.js';
import { writeZip } from '../../src/core/zip-write.js';
import { indexWorkbook } from '../../src/batch/index/file-index.js';
import { inspectWorkbook } from '../../src/batch/index/inspect.js';
import { fixture, generated } from './helpers.js';

const meta = (name, bytes) => ({ id: 'f0001', name, relPath: name, size: bytes.length });
const sheetXml = (rows) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;

async function withFirstSheet(xml) {
  const bytes = fixture('plain_table.xlsx');
  const wb = await openWorkbook(bytes, 'plain_table.xlsx');
  const part = wb.sheets[0].part;
  const entries = [];
  for (const name of wb.pkg.names()) entries.push({ name, data: name === part ? new TextEncoder().encode(xml) : await wb.pkg.bytes(name) });
  return writeZip(entries);
}

const firstSheetState = async (xml) => {
  const bytes = await withFirstSheet(xml);
  const ix = await inspectWorkbook(bytes, meta('a.xlsx', bytes), ['nonEmpty']);
  return ix.sheets[0].nonEmpty;
};

test('inspecting with no needs changes nothing', async () => {
  const bytes = generated('mixed.xlsm');
  const base = await indexWorkbook(bytes, meta('mixed.xlsm', bytes));
  assert.deepEqual(await inspectWorkbook(bytes, meta('mixed.xlsm', bytes), []), base);
});

test('nonEmpty is null in the plain index and filled by inspect', async () => {
  const bytes = generated('mixed.xlsm');
  const base = await indexWorkbook(bytes, meta('mixed.xlsm', bytes));
  const ix = await inspectWorkbook(bytes, meta('mixed.xlsm', bytes), ['nonEmpty']);
  assert.equal(base.sheets[0].nonEmpty, null);
  assert.equal(ix.sheets[0].nonEmpty, true);
  assert.deepEqual({ ...ix, sheets: ix.sheets.map((s) => ({ ...s, nonEmpty: null })) }, base);
});

test('a sheet with no rows is empty', async () => {
  assert.equal(await firstSheetState(''), false);
});

test('a sheet with only styled blank cells is empty', async () => {
  assert.equal(await firstSheetState('<row r="1"><c r="A1" s="1"/><c r="B1" s="2"/></row>'), false);
});

test('a sheet with a value, an inline string or a formula is not empty', async () => {
  assert.equal(await firstSheetState('<row r="1"><c r="A1"><v>1</v></c></row>'), true);
  assert.equal(await firstSheetState('<row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row>'), true);
  assert.equal(await firstSheetState('<row r="1"><c r="A1"><f>1+1</f></c></row>'), true);
  assert.equal(await firstSheetState('<row r="1"><c r="A1" s="1"/><c r="B1" t="s"><v>0</v></c></row>'), true);
});

test('a refused file comes back refused and is not opened again', async () => {
  const bytes = generated('encrypted.xlsx');
  const ix = await inspectWorkbook(bytes, meta('encrypted.xlsx', bytes), ['nonEmpty']);
  assert.equal(ix.status, 'refused');
  assert.deepEqual(ix.refused, { code: 'file.encrypted' });
});

test('an unknown need is refused rather than ignored', async () => {
  const bytes = generated('mixed.xlsm');
  await assert.rejects(() => inspectWorkbook(bytes, meta('mixed.xlsm', bytes), ['everything']), /unknown need/);
});

test('inspecting never changes the bytes it was given', async () => {
  const bytes = generated('signed.xlsm');
  const copy = bytes.slice();
  await inspectWorkbook(bytes, meta('signed.xlsm', bytes), ['nonEmpty']);
  assert.deepEqual(bytes, copy);
});
