import test from 'node:test';
import assert from 'node:assert/strict';
import { openWorkbook } from '../../src/core/workbook.js';
import { readUsedGrid } from '../../src/core/cells.js';
import { applyChangeSet, emptyChangeSet, selfCheck } from '../../src/core/save.js';
import { runOnce } from '../../src/core/m/engine.js';
import { addSheetsToPackage } from '../../src/core/sheet/add-sheets.js';
import { expectedGrid } from '../../src/core/sheet/grid.js';
import { QuoinError } from '../../src/core/errors.js';
import { fixture } from './helpers.js';

const NOW = new Date('2026-11-14T10:00:00Z');
const tableOf = (m) => runOnce({ sectionText: `section Section1;\r\n\r\nshared Result =\r\n${m};`, queryName: 'Result', now: '2026-11-14T10:00:00.000Z', previewRows: 1 }).value;
const SMALL = '#table({"Name", "Score"}, {{"Ann", 1}, {"Bob", 2.5}})';
const TYPED = '#table({"D","Span","Txt"}, {{#date(2026, 11, 14), #duration(1, 2, 0, 0), "x"}})';
const entry = (name, m = TYPED) => ({ name, table: tableOf(m), culture: 'en-US' });
const withSheets = (...entries) => {
  const cs = emptyChangeSet();
  cs.sheets.add.push(...entries);
  return cs;
};

const STYLES_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
const STYLES_TAIL = '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>';
const KNOWN_FORMATS = '<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd\\ hh:mm:ss"/><numFmt numFmtId="165" formatCode="[h]:mm:ss"/></numFmts>';

async function withStyles(numFmts) {
  const source = await openWorkbook(fixture('pq_simple.xlsx'), 'pq_simple.xlsx');
  const pkg = source.pkg.clone();
  const before = await pkg.text('xl/styles.xml');
  await pkg.setText('xl/styles.xml', `${STYLES_HEAD}${numFmts}${STYLES_TAIL}`, before);
  return openWorkbook(await pkg.write({ now: NOW }), 'styled.xlsx');
}

async function prepared(workbook = 'pq_simple.xlsx', adds = [{ name: 'Clean', table: tableOf(SMALL), culture: 'en-US' }]) {
  const wb = await openWorkbook(fixture(workbook), workbook);
  const pkg = wb.pkg.clone();
  const cs = withSheets(...adds);
  const written = await addSheetsToPackage(wb, pkg, cs.sheets.add);
  const bytes = await pkg.write({ now: NOW });
  const expected = { changes: cs, touched: written.touched, addedParts: written.addedParts, removedParts: new Set(), signatureRemoved: false, partTexts: written.texts, insertions: written.insertions };
  return { wb, bytes, expected, written };
}

async function tampered(bytes, part, change) {
  const back = await openWorkbook(bytes, 'out.xlsx');
  const pkg = back.pkg.clone();
  const text = await pkg.text(part);
  const next = change(text.text);
  assert.notEqual(next, text.text, `the edit to ${part} did not apply`);
  await pkg.setText(part, next, text);
  return pkg.write({ now: NOW });
}

const refused = (pattern) => (e) => e instanceof QuoinError && e.code === 'write.selfcheck' && pattern.test(e.message);

test('what addSheetsToPackage declares is accepted by the check', async () => {
  const { wb, bytes, expected } = await prepared();
  await selfCheck(wb, bytes, expected);
});

const TAMPERS = [
  ['T0 one space appended to workbook.xml', 'xl/workbook.xml', (x) => `${x} `],
  ['T1 the 1904 date system switched on', 'xl/workbook.xml', (x) => (/<workbookPr/.test(x) ? x.replace(/<workbookPr/, '<workbookPr date1904="1"') : x.replace(/<sheets>/, '<workbookPr date1904="1"/><sheets>'))],
  ['T2 the first existing sheet hidden', 'xl/workbook.xml', (x) => x.replace(/<sheet /, '<sheet state="hidden" ')],
  ['T3 the first two cell formats swapped', 'xl/styles.xml', (x) => {
    const m = x.match(/<cellXfs[^>]*>(<xf [^>]*?(?:\/>|>.*?<\/xf>))(<xf [^>]*?(?:\/>|>.*?<\/xf>))/s);
    return m ? x.replace(m[1] + m[2], m[2] + m[1]) : x;
  }],
  ['T4 an Override of an existing part dropped', '[Content_Types].xml', (x) => x.replace(/<Override PartName="\/xl\/theme\/theme1.xml"[^>]*\/>/, '')],
  ['T5 an existing relationship dropped', 'xl/_rels/workbook.xml.rels', (x) => x.replace(/<Relationship Id="[^"]*" Type="[^"]*\/theme" Target="[^"]*"\/>/, '')],
  ['T6 the new sheet hidden', 'xl/workbook.xml', (x) => x.replace(/<sheet name="Clean"/, '<sheet state="hidden" name="Clean"')],
  ['T7 a defined name injected next to the new sheet', 'xl/workbook.xml', (x) => x.replace('</sheets>', '</sheets><definedNames><definedName name="Injected">1</definedName></definedNames>')],
  ['T8 only the count of the cell formats changed', 'xl/styles.xml', (x) => x.replace(/(<cellXfs[^>]*count=")(\d+)/, (m, a, n) => `${a}${Number(n) + 7}`)],
  ['the new sheet part edited', 'xl/worksheets/sheet3.xml', (x) => x.replace('<sheetData>', '<sheetData><row r="99"><c r="A99"><v>1</v></c></row>')]
];

for (const [label, part, change] of TAMPERS) {
  test(`a sheet added to a copy is refused when ${label}`, async () => {
    const { wb, bytes, expected } = await prepared();
    const bad = await tampered(bytes, part, change);
    await assert.rejects(() => selfCheck(wb, bad, expected), refused(/check\.part/));
  });
}

for (const [label, part, change] of TAMPERS.filter(([, p]) => !p.includes('worksheets'))) {
  test(`${label}: refused even when the writer itself had expected the damaged text`, async () => {
    const { wb, bytes, expected } = await prepared();
    const bad = await tampered(bytes, part, change);
    const badText = (await (await openWorkbook(bad, 'bad.xlsx')).pkg.text(part)).text;
    const liar = { ...expected, partTexts: new Map([...expected.partTexts, [part, badText]]) };
    await assert.rejects(() => selfCheck(wb, bad, liar), refused(/check\.part/));
  });
}

test('a count that no longer matches its children is refused even when the text was declared and the fragments are intact', async () => {
  const { wb, bytes, expected } = await prepared();
  const bad = await tampered(bytes, 'xl/styles.xml', TAMPERS[8][2]);
  const badText = (await (await openWorkbook(bad, 'bad.xlsx')).pkg.text('xl/styles.xml')).text;
  const liar = { ...expected, partTexts: new Map([...expected.partTexts, ['xl/styles.xml', badText]]) };
  await assert.rejects(() => selfCheck(wb, bad, liar), refused(/check\.part xl\/styles\.xml/));
});

test('a new sheet whose content type was dropped is refused by name', async () => {
  const { wb, bytes, expected } = await prepared();
  const bad = await tampered(bytes, '[Content_Types].xml', (x) => x.replace(/<Override PartName="\/xl\/worksheets\/sheet3.xml"[^>]*\/>/, ''));
  await assert.rejects(() => selfCheck(wb, bad, expected), refused(/check\.part xl\/worksheets\/sheet3\.xml/));
});

test('a declared insertion that was not made is refused even when the same text is already in the original', async () => {
  const { wb, bytes, expected } = await prepared();
  const types = (await wb.pkg.text('[Content_Types].xml')).text;
  const existing = types.match(/<Override PartName="\/xl\/theme\/theme1.xml"[^>]*\/>/)[0];
  const ins = expected.insertions.get('[Content_Types].xml');
  const lying = new Map([...expected.insertions, ['[Content_Types].xml', { ...ins, fragments: [...ins.fragments, existing] }]]);
  await assert.rejects(() => selfCheck(wb, bytes, { ...expected, insertions: lying }), refused(/check\.part \[Content_Types\]\.xml/));
});

test('a part another writer had already changed is checked against the text it had before the sheets were added, and only when that is declared', async () => {
  const wb = await openWorkbook(fixture('pq_simple.xlsx'), 'pq_simple.xlsx');
  const pkg = wb.pkg.clone();
  const earlier = await pkg.text('xl/workbook.xml');
  await pkg.setText('xl/workbook.xml', `${earlier.text}\n`, earlier);
  const cs = withSheets({ name: 'Clean', table: tableOf(SMALL), culture: 'en-US' });
  const written = await addSheetsToPackage(wb, pkg, cs.sheets.add);
  const bytes = await pkg.write({ now: NOW });
  const expected = { changes: cs, touched: new Set([...written.touched]), addedParts: written.addedParts, removedParts: new Set(), signatureRemoved: false, partTexts: written.texts, insertions: written.insertions };
  await assert.rejects(() => selfCheck(wb, bytes, expected), refused(/check\.part xl\/workbook\.xml/));
  await selfCheck(wb, bytes, { ...expected, touchedBefore: new Set(['xl/workbook.xml']) });
});

test('the declaration is exactly what a new sheet adds: four parts, whole fragments, counts only for what changed', async () => {
  const { wb, written } = await prepared();
  assert.deepEqual([...written.insertions.keys()].sort(), ['[Content_Types].xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml']);
  assert.deepEqual([...written.texts.keys()].sort(), [...written.insertions.keys()].sort());
  for (const [part, { base, fragments }] of written.insertions) {
    assert.equal(base, (await wb.pkg.text(part)).text);
    for (const f of fragments) assert.equal(base.includes(f), false, `${part} already holds ${String(f).slice(0, 40)}`);
  }
  assert.deepEqual(written.insertions.get('xl/styles.xml').countElements, ['fonts', 'cellXfs', 'numFmts']);
  assert.deepEqual(written.insertions.get('xl/workbook.xml').countElements, []);
});

test('one sheet is added to a workbook with no numFmts and the after-write check accepts it', async () => {
  const wb = await withStyles('');
  assert.equal(/<numFmts\b/.test((await wb.pkg.text('xl/styles.xml')).text), false);
  const out = await applyChangeSet(wb, withSheets(entry('Clean')), { now: NOW });
  const back = await openWorkbook(out.bytes, 'out.xlsx');
  assert.equal(back.sheets.at(-1).name, 'Clean');
  assert.deepEqual(await readUsedGrid(back, 'Clean'), expectedGrid(entry('Clean').table, 'en-US'));
  const styles = (await back.pkg.text('xl/styles.xml')).text;
  assert.match(styles, /<numFmts count="2">/);
  assert.equal((styles.match(/<numFmts\b/g) || []).length, 1);
});

test('two sheets are added to a workbook with no numFmts and the after-write check accepts both', async () => {
  const wb = await withStyles('');
  const out = await applyChangeSet(wb, withSheets(entry('One'), entry('Two')), { now: NOW });
  const back = await openWorkbook(out.bytes, 'out.xlsx');
  assert.deepEqual(back.sheets.map((s) => s.name).slice(-2), ['One', 'Two']);
  assert.deepEqual(await readUsedGrid(back, 'Two'), await readUsedGrid(back, 'One'));
  const styles = (await back.pkg.text('xl/styles.xml')).text;
  assert.equal((styles.match(/<numFmts\b/g) || []).length, 1);
  assert.equal((styles.match(/formatCode=/g) || []).length, 2);
});

test('a workbook whose numFmts is an empty element takes a sheet and the element is replaced by a counted one', async () => {
  const wb = await withStyles('<numFmts count="0"/>');
  const out = await applyChangeSet(wb, withSheets(entry('Clean')), { now: NOW });
  const styles = (await (await openWorkbook(out.bytes, 'out.xlsx')).pkg.text('xl/styles.xml')).text;
  assert.match(styles, /<numFmts count="2">/);
  assert.equal((styles.match(/<numFmts\b/g) || []).length, 1);
});

test('a workbook that already has the two formats takes a sheet without creating them again', async () => {
  const wb = await withStyles(KNOWN_FORMATS);
  const out = await applyChangeSet(wb, withSheets(entry('Clean')), { now: NOW });
  const styles = (await (await openWorkbook(out.bytes, 'out.xlsx')).pkg.text('xl/styles.xml')).text;
  assert.equal((styles.match(/formatCode=/g) || []).length, 2);
  assert.match(styles, /<numFmts count="2">/);
});

test('a workbook with other formats takes a sheet and its numFmts count grows by the two it gains', async () => {
  const wb = await withStyles('<numFmts count="1"><numFmt numFmtId="170" formatCode="0.000"/></numFmts>');
  const out = await applyChangeSet(wb, withSheets(entry('Clean')), { now: NOW });
  const styles = (await (await openWorkbook(out.bytes, 'out.xlsx')).pkg.text('xl/styles.xml')).text;
  assert.match(styles, /<numFmts count="3">/);
  assert.equal((styles.match(/formatCode=/g) || []).length, 3);
});

test('an Excel-made macro workbook takes a new sheet and keeps its VBA project', async () => {
  const wb = await openWorkbook(fixture('xw_macro04.xlsm'), 'xw_macro04.xlsm');
  const before = wb.pkg.zip.get(wb.vba.part).crc32;
  const out = await applyChangeSet(wb, withSheets(entry('Clean')), { now: NOW });
  const back = await openWorkbook(out.bytes, 'out.xlsm');
  assert.equal(back.sheets.at(-1).name, 'Clean');
  assert.deepEqual(await readUsedGrid(back, 'Clean'), expectedGrid(entry('Clean').table, 'en-US'));
  assert.equal(back.pkg.zip.get(wb.vba.part).crc32, before);
});

test('two sheets are added to the macro workbook and each is read back', async () => {
  const wb = await openWorkbook(fixture('xw_macro04.xlsm'), 'xw_macro04.xlsm');
  const out = await applyChangeSet(wb, withSheets(entry('One'), entry('Two', SMALL)), { now: NOW });
  const back = await openWorkbook(out.bytes, 'out.xlsm');
  assert.deepEqual(back.sheets.map((s) => s.name).slice(-2), ['One', 'Two']);
  assert.deepEqual(await readUsedGrid(back, 'Two'), expectedGrid(tableOf(SMALL), 'en-US'));
});
