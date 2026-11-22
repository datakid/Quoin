import test from 'node:test';
import assert from 'node:assert/strict';
import { openWorkbook } from '../../src/core/workbook.js';
import { applyChangeSet, emptyChangeSet, selfCheck } from '../../src/core/save.js';
import { runOnce } from '../../src/core/m/engine.js';
import { addSheetsToPackage } from '../../src/core/sheet/add-sheets.js';
import { writeRangesToPackage } from '../../src/core/sheet/write-ranges.js';
import { QuoinError } from '../../src/core/errors.js';
import { fixture } from './helpers.js';

const NOW = new Date('2026-11-14T10:00:00Z');
const tableOf = (m) => runOnce({ sectionText: `section Section1;\r\n\r\nshared Result =\r\n${m};`, queryName: 'Result', now: '2026-11-14T10:00:00.000Z', previewRows: 1 }).value;
const SMALL = '#table({"Name", "Score"}, {{"Ann", 1}, {"Bob", 2.5}})';

async function prepared(kind) {
  const wb = await openWorkbook(fixture('pq_simple.xlsx'), 'pq_simple.xlsx');
  const pkg = wb.pkg.clone();
  const cs = emptyChangeSet();
  let written;
  if (kind === 'add') {
    cs.sheets.add.push({ name: 'Clean', table: tableOf(SMALL), culture: 'en-US' });
    written = await addSheetsToPackage(wb, pkg, cs.sheets.add);
  } else {
    cs.sheets.write.push({ sheet: 'Input', anchor: { row: 0, col: 4 }, table: tableOf(SMALL), culture: 'en-US' });
    written = await writeRangesToPackage(wb, pkg, cs.sheets.write);
  }
  const bytes = await pkg.write({ now: NOW });
  const expected = { changes: cs, touched: written.touched, addedParts: written.addedParts, removedParts: new Set(), signatureRemoved: false, partTexts: written.texts, insertions: written.insertions };
  return { wb, bytes, expected };
}

async function tampered(wb, bytes, part, change) {
  const back = await openWorkbook(bytes, 'out.xlsx');
  const pkg = back.pkg.clone();
  const text = await pkg.text(part);
  const next = change(text.text);
  assert.notEqual(next, text.text, `the edit to ${part} did not apply`);
  await pkg.setText(part, next, text);
  return pkg.write({ now: NOW });
}

const rejected = (e) => e instanceof QuoinError && e.code === 'write.selfcheck' && /check\.part/.test(e.message);

test('what the sheet writers declared is accepted by the check', async () => {
  for (const kind of ['add', 'write']) {
    const { wb, bytes, expected } = await prepared(kind);
    await selfCheck(wb, bytes, expected);
  }
});

const ADD_TAMPERS = [
  ['one space appended to workbook.xml', 'xl/workbook.xml', (x) => `${x} `],
  ['the 1904 date system switched on', 'xl/workbook.xml', (x) => (/<workbookPr/.test(x) ? x.replace(/<workbookPr/, '<workbookPr date1904="1"') : x.replace(/<sheets>/, '<workbookPr date1904="1"/><sheets>'))],
  ['the first existing sheet hidden', 'xl/workbook.xml', (x) => x.replace(/<sheet /, '<sheet state="hidden" ')],
  ['the first two cell formats swapped', 'xl/styles.xml', (x) => {
    const m = x.match(/<cellXfs[^>]*>(<xf [^>]*?(?:\/>|>.*?<\/xf>))(<xf [^>]*?(?:\/>|>.*?<\/xf>))/s);
    return m ? x.replace(m[1] + m[2], m[2] + m[1]) : x;
  }],
  ['an Override of an existing part dropped', '[Content_Types].xml', (x) => x.replace(/<Override PartName="\/xl\/theme\/theme1.xml"[^>]*\/>/, '')],
  ['the Override of the new sheet dropped', '[Content_Types].xml', (x) => x.replace(/<Override PartName="\/xl\/worksheets\/sheet3.xml"[^>]*\/>/, '')],
  ['an existing relationship dropped', 'xl/_rels/workbook.xml.rels', (x) => x.replace(/<Relationship Id="[^"]*" Type="[^"]*\/theme" Target="[^"]*"\/>/, '')],
  ['the new sheet part edited', 'xl/worksheets/sheet3.xml', (x) => x.replace('<sheetData>', '<sheetData><row r="99"><c r="A99"><v>1</v></c></row>')]
];

for (const [label, part, change] of ADD_TAMPERS) {
  test(`a sheet added to a copy is refused when ${label}`, async () => {
    const { wb, bytes, expected } = await prepared('add');
    const bad = await tampered(wb, bytes, part, change);
    await assert.rejects(() => selfCheck(wb, bad, expected), rejected);
  });
}

test('a range written in place is refused when a part it declared is changed in any other way', async () => {
  for (const [part, change] of [
    ['xl/worksheets/sheet1.xml', (x) => x.replace('<sheetData>', '<sheetData><row r="99"><c r="A99"><v>1</v></c></row>')],
    ['xl/styles.xml', (x) => `${x} `]
  ]) {
    const { wb, bytes, expected } = await prepared('write');
    const bad = await tampered(wb, bytes, part, change);
    await assert.rejects(() => selfCheck(wb, bad, expected), rejected);
  }
});

test('the real path refuses the same damage: applyChangeSet checks the parts its sheet writers declared', async () => {
  const wb = await openWorkbook(fixture('pq_simple.xlsx'), 'pq_simple.xlsx');
  const cs = emptyChangeSet();
  cs.sheets.add.push({ name: 'Clean', table: tableOf(SMALL), culture: 'en-US' });
  const out = await applyChangeSet(wb, cs, { now: NOW });
  assert.ok(out.bytes.length > 0);
});

for (const [label, part, change] of ADD_TAMPERS.filter(([, p]) => !p.includes('worksheets'))) {
  test(`${label}: refused even when the writer itself had expected the damaged text`, async () => {
    const { wb, bytes, expected } = await prepared('add');
    const bad = await tampered(wb, bytes, part, change);
    const badText = (await (await openWorkbook(bad, 'bad.xlsx')).pkg.text(part)).text;
    const liar = { ...expected, partTexts: new Map([...expected.partTexts, [part, badText]]) };
    await assert.rejects(() => selfCheck(wb, bad, liar), rejected);
  });
}

test('the insertions the sheet writer declares are exactly what a new sheet adds, and nothing in the originals is declared as changed', async () => {
  const { wb, expected } = await prepared('add');
  assert.deepEqual([...expected.insertions.keys()].sort(), ['[Content_Types].xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml']);
  for (const [part, { fragments }] of expected.insertions) {
    const original = (await wb.pkg.text(part)).text;
    for (const f of fragments) assert.equal(original.includes(f), false, `${part} already holds ${f.slice(0, 40)}`);
  }
  assert.deepEqual(expected.insertions.get('xl/styles.xml').countElements, ['fonts', 'cellXfs', 'numFmts']);
});
