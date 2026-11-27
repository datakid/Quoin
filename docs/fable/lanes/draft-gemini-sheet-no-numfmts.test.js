import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openWorkbook } from '../../src/core/workbook.js';
import { readUsedGrid } from '../../src/core/cells.js';
import { applyChangeSet, emptyChangeSet } from '../../src/core/save.js';
import { runOnce } from '../../src/core/m/engine.js';
import { expectedGrid } from '../../src/core/sheet/grid.js';
import { fixture, root } from './helpers.js';


const NOW = new Date('2026-11-14T10:00:00Z');
const tableOf = (m) => runOnce({ sectionText: `section Section1;\r\n\r\nshared Result =\r\n${m};`, queryName: 'Result', now: '2026-11-14T10:00:00.000Z', previewRows: 1 }).value;
const TYPED = '#table({"D","Span","Txt"}, {{#date(2026, 11, 14), #duration(1, 2, 0, 0), "x"}})';
const entry = (name, m = TYPED) => ({ name, table: tableOf(m), culture: 'en-US' });
const withSheets = (...entries) => {
  const cs = emptyChangeSet();
  cs.sheets.add.push(...entries);
  return cs;
};

const BARE_STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
  + '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
  + '</styleSheet>';

async function withoutNumFmts() {
  const source = await openWorkbook(fixture('pq_simple.xlsx'), 'pq_simple.xlsx');
  const pkg = source.pkg.clone();
  const before = await pkg.text('xl/styles.xml');
  await pkg.setText('xl/styles.xml', BARE_STYLES, before);
  const bytes = await pkg.write({ now: NOW });
  const wb = await openWorkbook(bytes, 'no-numfmts.xlsx');
  const styles = (await wb.pkg.text('xl/styles.xml')).text;
  assert.equal(/<numFmts\b/.test(styles), false, 'the workbook must have no numFmts for these tests to mean anything');
  return wb;
}

test('one sheet is added to a workbook with no numFmts and the after-write check accepts it', async () => {
  const wb = await withoutNumFmts();
  const out = await applyChangeSet(wb, withSheets(entry('Clean')), { now: NOW });
  const back = await openWorkbook(out.bytes, 'out.xlsx');
  assert.equal(back.sheets.at(-1).name, 'Clean');
  assert.deepEqual(await readUsedGrid(back, 'Clean'), expectedGrid(entry('Clean').table, 'en-US'));
  const styles = (await back.pkg.text('xl/styles.xml')).text;
  assert.match(styles, /<numFmts count="2">/, 'the numFmts element is created, with its count');
  assert.equal((styles.match(/<numFmts\b/g) || []).length, 1, 'exactly one numFmts element');
});

test('two sheets are added to a workbook with no numFmts and the after-write check accepts both', async () => {
  const wb = await withoutNumFmts();
  const out = await applyChangeSet(wb, withSheets(entry('One'), entry('Two')), { now: NOW });
  const back = await openWorkbook(out.bytes, 'out.xlsx');
  assert.deepEqual(back.sheets.map((s) => s.name).slice(-2), ['One', 'Two']);
  assert.deepEqual(await readUsedGrid(back, 'Two'), await readUsedGrid(back, 'One'));
  const styles = (await back.pkg.text('xl/styles.xml')).text;
  assert.equal((styles.match(/<numFmts\b/g) || []).length, 1);
  assert.equal((styles.match(/formatCode=/g) || []).length, 2, 'two formats are created once, not once per sheet');
});

const MACRO = join(root, 'tests', 'fixtures', 'external', 'xw_macro04.xlsm');

test('an Excel-made macro workbook takes a new sheet and keeps its VBA project', { skip: !existsSync(MACRO) }, async () => {
  const wb = await openWorkbook(fixture('xw_macro04.xlsm'), 'xw_macro04.xlsm');
  const vbaPart = wb.vba.part;
  const before = wb.pkg.zip.get(vbaPart).crc32;
  const out = await applyChangeSet(wb, withSheets(entry('Clean')), { now: NOW });
  const back = await openWorkbook(out.bytes, 'out.xlsm');
  assert.equal(back.sheets.at(-1).name, 'Clean');
  assert.deepEqual(await readUsedGrid(back, 'Clean'), expectedGrid(entry('Clean').table, 'en-US'));
  assert.equal(back.pkg.zip.get(vbaPart).crc32, before, 'the VBA project is byte for byte the same');
});
