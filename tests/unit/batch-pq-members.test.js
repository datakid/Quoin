import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openWorkbook } from '../../src/core/workbook.js';
import { applyChangeSet, emptyChangeSet, selfCheck } from '../../src/core/save.js';
import { buildDataMashup } from '../../src/core/pq/datamashup.js';
import { removeMetadataItems, renameMetadataItems } from '../../src/core/pq/members.js';
import { base64Encode } from '../../src/core/bytes.js';
import { applyEdits, parseXml, textContentEdit } from '../../src/core/xml.js';
import { checkSection } from '../../src/core/m/engine.js';
import { fixture, generated } from './helpers.js';

const NOW = new Date(2026, 10, 14, 10, 0, 0);
const NEW_M = 'let\n    Source = 1\nin\n    Source';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

const openSimple = () => openWorkbook(fixture('pq_simple.xlsx'), 'pq_simple.xlsx');

async function addTo(wb, adds, extra = {}) {
  const cs = emptyChangeSet();
  for (const [name, text] of adds) cs.queries.add.set(name, text);
  const res = await applyChangeSet(wb, cs, { now: NOW, checkSection, ...extra });
  return { res, back: await openWorkbook(res.bytes, 'out.xlsx') };
}

const itemFor = (xml, name) => {
  const i = xml.indexOf(`<ItemPath>Section1/${name}</ItemPath>`);
  assert.ok(i >= 0, `item for ${name}`);
  const start = xml.lastIndexOf('<Item>', i);
  return xml.slice(start, xml.indexOf('</Item>', i) + '</Item>'.length);
};

test('F2-03: an added query is listed, connection-only, and the output opens with no warning', async () => {
  const wb = await openSimple();
  const { res, back } = await addTo(wb, [['Extra', NEW_M]]);
  assert.equal(res.queriesChanged, 1);
  assert.deepEqual(back.queries.map((q) => q.name), ['StudentResults', 'Extra']);
  assert.equal(back.queries[1].original, NEW_M);
  assert.deepEqual(back.queries[1].load, { kind: 'connection' });
  assert.equal(back.queries[1].connection, null);
  assert.equal(back.queries[0].original, wb.queries[0].original);
  assert.deepEqual(back.warnings, []);
});

test('F2-03: the existing query text and the section start are untouched and the new member follows them', async () => {
  const wb = await openSimple();
  const { back } = await addTo(wb, [['Extra', NEW_M]]);
  const before = wb.mashup.section.text;
  const after = back.mashup.section.text;
  assert.ok(after.startsWith(before.replace(/\s+$/, '')));
  const eol = /\r\n/.test(before) ? '\r\n' : '\n';
  assert.ok(after.replace(/\s+$/, '').endsWith(`${eol}${eol}shared Extra = let${eol}    Source = 1${eol}in${eol}    Source;`));
  assert.equal(after.length - before.length, `${eol}${eol}shared Extra = let${eol}    Source = 1${eol}in${eol}    Source;`.length);
});

test('F2-03: the metadata gains one connection-only item and every other byte of it stays', async () => {
  const wb = await openSimple();
  const { back } = await addTo(wb, [['Extra', NEW_M]]);
  const before = wb.mashup.model.metadata.xml;
  const after = back.mashup.model.metadata.xml;
  const item = itemFor(after, 'Extra');
  assert.equal(after, before.replace('</Items>', `${item}</Items>`));
  const id = /Type="QueryID" Value="s([^"]+)"/.exec(item)[1];
  assert.match(id, GUID);
  for (const entry of ['IsPrivate" Value="l0', 'FillEnabled" Value="l0', 'FillObjectType" Value="sConnectionOnly', 'FillToDataModelEnabled" Value="l0']) assert.ok(item.includes(`Type="${entry}"`), entry);
  assert.equal(back.mashup.model.metadata.version, wb.mashup.model.metadata.version);
  assert.deepEqual(back.mashup.model.metadata.content, wb.mashup.model.metadata.content);
  assert.deepEqual(back.mashup.model.permissionBindings, wb.mashup.model.permissionBindings);
});

test('F2-03: the same now gives the same bytes and the same query id; another name gives another id', async () => {
  const wb = await openSimple();
  const a = await addTo(wb, [['Extra', NEW_M]]);
  const b = await addTo(wb, [['Extra', NEW_M]]);
  assert.equal(sha(a.res.bytes), sha(b.res.bytes));
  const c = await addTo(wb, [['Other', NEW_M]]);
  const idOf = (back, name) => /Type="QueryID" Value="s([^"]+)"/.exec(itemFor(back.mashup.model.metadata.xml, name))[1];
  assert.equal(idOf(a.back, 'Extra'), idOf(b.back, 'Extra'));
  assert.notEqual(idOf(a.back, 'Extra'), idOf(c.back, 'Other'));
});

test('F2-03: a name with spaces, a keyword and a name with a quote are written quoted and read back', async () => {
  const wb = await openSimple();
  const { back } = await addTo(wb, [['My New Query', NEW_M], ['let', NEW_M], ['a"b', NEW_M], ['Plain_1', NEW_M]]);
  assert.deepEqual(back.queries.map((q) => q.name), ['StudentResults', 'My New Query', 'let', 'a"b', 'Plain_1']);
  const text = back.mashup.section.text;
  assert.ok(text.includes('shared #"My New Query" = '));
  assert.ok(text.includes('shared #"let" = '));
  assert.ok(text.includes('shared #"a""b" = '));
  assert.ok(text.includes('shared Plain_1 = '));
  assert.ok(back.mashup.model.metadata.xml.includes('<ItemPath>Section1/My%20New%20Query</ItemPath>'));
  assert.deepEqual(back.warnings, []);
});

test('F2-03: text that ends in a line comment still ends its member', async () => {
  const wb = await openSimple();
  const text = 'let\n    Source = 1\nin\n    Source // done';
  const { back } = await addTo(wb, [['Extra', text]]);
  assert.equal(back.queries[1].original, text);
  assert.deepEqual(back.warnings, []);
});

test('F2-03: several adds keep their order', async () => {
  const wb = await openSimple();
  const { back } = await addTo(wb, [['Zeta', NEW_M], ['Alpha', NEW_M]]);
  assert.deepEqual(back.queries.map((q) => q.name), ['StudentResults', 'Zeta', 'Alpha']);
});

test('F2-03: an add together with a replace and a module edit in one ChangeSet', async () => {
  const wb = await openWorkbook(generated('mixed.xlsm'), 'mixed.xlsm');
  const cs = emptyChangeSet();
  cs.queries.add.set('Extra', NEW_M);
  cs.queries.replace.set('FinalTable', `${wb.queries.find((q) => q.name === 'FinalTable').original}\n// edited`);
  cs.modules.replace.set('Module1', `${wb.vba.project.modules.find((m) => m.name === 'Module1').model.visible}\n' edited\n`);
  const res = await applyChangeSet(wb, cs, { now: NOW, checkSection });
  const back = await openWorkbook(res.bytes, 'out.xlsm');
  assert.equal(res.queriesChanged, 2);
  assert.equal(res.modulesChanged, 1);
  assert.deepEqual(back.queries.map((q) => q.name), ['fGetNamedRange', 'RawInput', 'FinalTable', 'Extra']);
  assert.ok(back.queries[2].original.endsWith('// edited'));
  assert.deepEqual(back.warnings, []);
});

test('F2-03: a refresh flag on an added query changes nothing, because it has no connection', async () => {
  const wb = await openSimple();
  const plain = await addTo(wb, [['Extra', NEW_M]], { refreshOnLoad: false });
  const cs = emptyChangeSet();
  cs.queries.add.set('Extra', NEW_M);
  cs.refreshOnLoad.add('Extra');
  const flagged = await applyChangeSet(wb, cs, { now: NOW, checkSection, refreshOnLoad: false });
  assert.equal(sha(flagged.bytes), sha(plain.res.bytes));
});

test('F2-03: names that cannot be written safely are refused before anything is written', async () => {
  const wb = await openSimple();
  const bad = ['', ' Extra', 'Extra ', 'a\nb', 'StudentResults', 'studentresults'];
  for (const name of bad) {
    const cs = emptyChangeSet();
    cs.queries.add.set(name, NEW_M);
    await assert.rejects(() => applyChangeSet(wb, cs, { now: NOW }), TypeError, JSON.stringify(name));
  }
  const cs = emptyChangeSet();
  cs.queries.add.set('Same', NEW_M);
  cs.queries.add.set('same', NEW_M);
  await assert.rejects(() => applyChangeSet(wb, cs, { now: NOW }), TypeError);
});

test('F2-03: a workbook with no query data cannot take an add', async () => {
  const wb = await openWorkbook(fixture('plain_table.xlsx'), 'plain_table.xlsx');
  const cs = emptyChangeSet();
  cs.queries.add.set('Extra', NEW_M);
  await assert.rejects(() => applyChangeSet(wb, cs, { now: NOW }), (e) => e.code === 'pq.format');
});

test('F2-03: text that does not parse is refused with m.parse and nothing is written', async () => {
  const wb = await openSimple();
  const cs = emptyChangeSet();
  cs.queries.add.set('Extra', 'let Source = in');
  await assert.rejects(() => applyChangeSet(wb, cs, { now: NOW, checkSection }), (e) => e.code === 'm.parse');
});

async function mismatchedOutput(wb) {
  const m = wb.mashup;
  const section = { text: `${m.section.text}\r\n\r\nshared Extra = 1;`, bom: m.section.bom };
  const encoded = base64Encode(await buildDataMashup(m.model, section));
  const fresh = parseXml(m.text.text, m.part);
  const pkg = wb.pkg.clone();
  await pkg.setText(m.part, applyEdits(m.text.text, [textContentEdit(fresh.root, encoded)]), m.text);
  return pkg.write({ now: NOW });
}

test('F2-03: selfCheck rejects an output whose metadata does not match its section', async () => {
  const wb = await openSimple();
  const bytes = await mismatchedOutput(wb);
  const back = await openWorkbook(bytes, 'bad.xlsx');
  assert.ok(back.warnings.some((w) => w.code === 'pq.countMismatch'));
  const changes = emptyChangeSet();
  changes.queries.add.set('Extra', '1');
  await assert.rejects(
    () => selfCheck(wb, bytes, { changes, touched: new Set([wb.mashup.part]), addedParts: new Set(), removedParts: new Set(), signatureRemoved: false }),
    (e) => e.code === 'write.selfcheck'
  );
});

test('F2-03: a workbook whose metadata already does not match its section cannot take an add', async () => {
  const wb = await openSimple();
  const broken = await openWorkbook(await mismatchedOutput(wb), 'bad.xlsx');
  assert.ok(broken.warnings.some((w) => w.code === 'pq.countMismatch'));
  const cs = emptyChangeSet();
  cs.queries.add.set('Another', NEW_M);
  await assert.rejects(() => applyChangeSet(broken, cs, { now: NOW }), (e) => e.code === 'pq.format');
});

async function reopenWith(adds) {
  const wb = await openSimple();
  const { back } = await addTo(wb, adds);
  return { first: wb, wb: back };
}

async function removeFrom(wb, names, extra = {}) {
  const cs = emptyChangeSet();
  for (const name of names) cs.queries.remove.add(name);
  const res = await applyChangeSet(wb, cs, { now: NOW, checkSection, ...extra });
  return { res, back: await openWorkbook(res.bytes, 'out.xlsx') };
}

const queryNames = (wb) => wb.queries.map((q) => q.name);

test('F2-04: removing the only added query brings back the original section and metadata exactly', async () => {
  const { first, wb } = await reopenWith([['Extra', NEW_M]]);
  const { res, back } = await removeFrom(wb, ['Extra']);
  assert.equal(res.queriesChanged, 1);
  assert.deepEqual(queryNames(back), ['StudentResults']);
  assert.equal(back.mashup.section.text, first.mashup.section.text);
  assert.equal(back.mashup.model.metadata.xml, first.mashup.model.metadata.xml);
  assert.deepEqual(back.warnings, []);
});

test('F2-04: removing a middle query leaves its neighbours and their metadata', async () => {
  const { wb } = await reopenWith([['A', NEW_M], ['B', 'let\n    x = 2\nin\n    x'], ['C', NEW_M]]);
  const { back } = await removeFrom(wb, ['B']);
  assert.deepEqual(queryNames(back), ['StudentResults', 'A', 'C']);
  assert.equal(back.queries[1].original, NEW_M);
  assert.equal(back.queries[2].original, NEW_M);
  assert.equal(back.queries[0].original, wb.queries[0].original);
  assert.ok(!back.mashup.section.text.includes('shared B'));
  assert.ok(!back.mashup.model.metadata.xml.includes('Section1/B<'));
  assert.ok(back.mashup.model.metadata.xml.includes('Section1/A<'));
  assert.ok(back.mashup.model.metadata.xml.includes('Section1/C<'));
  assert.deepEqual(back.warnings, []);
});

test('F2-04: removing the first and the last of several gives the same text as never adding them', async () => {
  const { wb } = await reopenWith([['A', NEW_M], ['B', NEW_M], ['C', NEW_M]]);
  const { back } = await removeFrom(wb, ['A', 'C']);
  const only = await reopenWith([['B', NEW_M]]);
  assert.equal(back.mashup.section.text, only.wb.mashup.section.text);
  assert.equal(back.mashup.model.metadata.xml.replace(/QueryID" Value="s[^"]+/g, ''), only.wb.mashup.model.metadata.xml.replace(/QueryID" Value="s[^"]+/g, ''));
});

test('F2-04: removing two neighbours at the end and then everything added', async () => {
  const { first, wb } = await reopenWith([['A', NEW_M], ['B', NEW_M], ['C', NEW_M]]);
  const { back } = await removeFrom(wb, ['B', 'C']);
  assert.deepEqual(queryNames(back), ['StudentResults', 'A']);
  const gone = await removeFrom(wb, ['A', 'B', 'C']);
  assert.equal(gone.back.mashup.section.text, first.mashup.section.text);
});

test('F2-04: the metadata remover takes the query item and every step item and nothing else', async () => {
  const wb = await openWorkbook(fixture('pq_vba_complex.xlsm'), 'pq_vba_complex.xlsm');
  const xml = wb.mashup.model.metadata.xml;
  const paths = (x) => [...x.matchAll(/<ItemPath>([^<]*)<\/ItemPath>/g)].map((m) => m[1]);
  const after = paths(removeMetadataItems(xml, new Set(['RawInput'])));
  assert.deepEqual(paths(xml).filter((p) => !after.includes(p)), ['Section1/RawInput', 'Section1/RawInput/Source', 'Section1/RawInput/Converted%20to%20Table', 'Section1/RawInput/Renamed%20Columns']);
  assert.equal(removeMetadataItems(xml, new Set(['Nothing'])), xml);
});

test('F2-04: a query that loads to a table or has a connection cannot be removed', async () => {
  for (const [wb, name] of [[await openSimple(), 'StudentResults'], [await openWorkbook(generated('mixed.xlsm'), 'mixed.xlsm'), 'fGetNamedRange'], [await openWorkbook(generated('mixed.xlsm'), 'mixed.xlsm'), 'FinalTable']]) {
    const cs = emptyChangeSet();
    cs.queries.remove.add(name);
    await assert.rejects(() => applyChangeSet(wb, cs, { now: NOW }), TypeError, name);
  }
});

test('F2-04: a query that other queries use cannot be removed, and the user can be named', async () => {
  const { wb } = await reopenWith([['A', NEW_M], ['B', 'A + 1']]);
  const cs = emptyChangeSet();
  cs.queries.remove.add('A');
  await assert.rejects(() => applyChangeSet(wb, cs, { now: NOW }), (e) => e instanceof TypeError && /refused.usedBy/.test(e.message) && /B/.test(e.message));
  const both = await removeFrom(wb, ['B']);
  assert.deepEqual(queryNames(both.back), ['StudentResults', 'A']);
});

test('F2-04: removing a name the file does not have fails with pq.unknown, and remove with replace on one name is refused', async () => {
  const { wb } = await reopenWith([['A', NEW_M]]);
  const unknown = emptyChangeSet();
  unknown.queries.remove.add('Nope');
  await assert.rejects(() => applyChangeSet(wb, unknown, { now: NOW }), (e) => e.code === 'pq.unknown');
  const clash = emptyChangeSet();
  clash.queries.remove.add('A');
  clash.queries.replace.set('A', 'let\n    x = 3\nin\n    x');
  await assert.rejects(() => applyChangeSet(wb, clash, { now: NOW }), TypeError);
});

test('F2-04: a remove together with an add and a replace in one ChangeSet', async () => {
  const { wb } = await reopenWith([['A', NEW_M], ['B', NEW_M]]);
  const cs = emptyChangeSet();
  cs.queries.remove.add('A');
  cs.queries.add.set('Z', NEW_M);
  cs.queries.replace.set('B', 'let\n    x = 9\nin\n    x');
  const res = await applyChangeSet(wb, cs, { now: NOW, checkSection });
  const back = await openWorkbook(res.bytes, 'out.xlsx');
  assert.equal(res.queriesChanged, 3);
  assert.deepEqual(queryNames(back), ['StudentResults', 'B', 'Z']);
  assert.equal(back.queries[1].original, 'let\n    x = 9\nin\n    x');
  assert.deepEqual(back.warnings, []);
});

test('F2-04: the same now gives the same bytes for a remove', async () => {
  const { wb } = await reopenWith([['A', NEW_M]]);
  const a = await removeFrom(wb, ['A']);
  const b = await removeFrom(wb, ['A']);
  assert.equal(sha(a.res.bytes), sha(b.res.bytes));
});

test('F2-04: a query that reads #shared can reach every query, so nothing can be removed while it is there', async () => {
  const { wb } = await reopenWith([['A', NEW_M], ['Reader', '#shared']]);
  const cs = emptyChangeSet();
  cs.queries.remove.add('A');
  await assert.rejects(() => applyChangeSet(wb, cs, { now: NOW }), (e) => e instanceof TypeError && /refused.usedBy: Reader/.test(e.message));
});

test('F2-04: a workbook whose metadata does not match its section cannot take a remove', async () => {
  const wb = await openSimple();
  const broken = await openWorkbook(await mismatchedOutput(wb), 'bad.xlsx');
  assert.ok(broken.queries.some((q) => q.name === 'Extra'));
  const cs = emptyChangeSet();
  cs.queries.remove.add('Extra');
  await assert.rejects(() => applyChangeSet(broken, cs, { now: NOW }), (e) => e.code === 'pq.format');
});

async function renameIn(wb, pairs, extra = {}) {
  const cs = emptyChangeSet();
  for (const [from, to] of pairs) cs.queries.rename.set(from, to);
  const res = await applyChangeSet(wb, cs, { now: NOW, checkSection, ...extra });
  return { res, back: await openWorkbook(res.bytes, 'out.xlsx') };
}

test('F2-05: a rename changes the member name and the metadata path and nothing else', async () => {
  const { wb } = await reopenWith([['Extra', NEW_M]]);
  const { res, back } = await renameIn(wb, [['Extra', 'Renamed']]);
  assert.equal(res.queriesChanged, 1);
  assert.deepEqual(queryNames(back), ['StudentResults', 'Renamed']);
  assert.equal(back.mashup.section.text, wb.mashup.section.text.replace('shared Extra =', 'shared Renamed ='));
  assert.equal(back.mashup.model.metadata.xml, wb.mashup.model.metadata.xml.replace('<ItemPath>Section1/Extra</ItemPath>', '<ItemPath>Section1/Renamed</ItemPath>'));
  assert.equal(back.queries[1].original, NEW_M);
  assert.deepEqual(back.warnings, []);
});

test('F2-05: a name that needs quotes is written quoted, and a quoted name becomes plain when it can', async () => {
  const { wb } = await reopenWith([['Extra', NEW_M]]);
  const quoted = await renameIn(wb, [['Extra', 'New Name']]);
  assert.ok(quoted.back.mashup.section.text.includes('shared #"New Name" = '));
  assert.ok(quoted.back.mashup.model.metadata.xml.includes('<ItemPath>Section1/New%20Name</ItemPath>'));
  const plain = await renameIn(quoted.back, [['New Name', 'Plain']]);
  assert.ok(plain.back.mashup.section.text.includes('shared Plain = '));
  assert.ok(!plain.back.mashup.section.text.includes('New Name'));
  assert.deepEqual(plain.back.warnings, []);
});

test('F2-05: the metadata renamer moves the query item and every step item and no other', async () => {
  const wb = await openWorkbook(fixture('pq_vba_complex.xlsm'), 'pq_vba_complex.xlsm');
  const xml = wb.mashup.model.metadata.xml;
  const paths = (x) => [...x.matchAll(/<ItemPath>([^<]*)<\/ItemPath>/g)].map((m) => m[1]);
  const before = paths(xml);
  const after = paths(renameMetadataItems(xml, new Map([['RawInput', 'Raw Data']])));
  assert.equal(after.length, before.length);
  assert.deepEqual(after.filter((p) => !before.includes(p)), ['Section1/Raw%20Data', 'Section1/Raw%20Data/Source', 'Section1/Raw%20Data/Converted%20to%20Table', 'Section1/Raw%20Data/Renamed%20Columns']);
  assert.deepEqual(before.filter((p) => !after.includes(p)), ['Section1/RawInput', 'Section1/RawInput/Source', 'Section1/RawInput/Converted%20to%20Table', 'Section1/RawInput/Renamed%20Columns']);
  assert.equal(renameMetadataItems(xml, new Map([['Nothing', 'Else']])), xml);
});

test('F2-05: a change of case only is a rename', async () => {
  const { wb } = await reopenWith([['extra', NEW_M]]);
  const { back } = await renameIn(wb, [['extra', 'Extra']]);
  assert.deepEqual(queryNames(back), ['StudentResults', 'Extra']);
});

test('F2-05: two queries can swap names in one change', async () => {
  const { wb } = await reopenWith([['A', NEW_M], ['B', 'let\n    x = 2\nin\n    x']]);
  const { back } = await renameIn(wb, [['A', 'B'], ['B', 'A']]);
  assert.deepEqual(queryNames(back), ['StudentResults', 'B', 'A']);
  assert.equal(back.queries[1].original, NEW_M);
  assert.equal(back.queries[2].original, 'let\n    x = 2\nin\n    x');
  assert.deepEqual(back.warnings, []);
});

test('F2-05: a rename and a replace of the same query, and a rename with an add and a remove', async () => {
  const { wb } = await reopenWith([['A', NEW_M], ['B', NEW_M]]);
  const cs = emptyChangeSet();
  cs.queries.rename.set('A', 'C');
  cs.queries.replace.set('A', 'let\n    x = 5\nin\n    x');
  cs.queries.remove.add('B');
  cs.queries.add.set('D', NEW_M);
  const res = await applyChangeSet(wb, cs, { now: NOW, checkSection });
  const back = await openWorkbook(res.bytes, 'out.xlsx');
  assert.equal(res.queriesChanged, 4);
  assert.deepEqual(queryNames(back), ['StudentResults', 'C', 'D']);
  assert.equal(back.queries[1].original, 'let\n    x = 5\nin\n    x');
  assert.deepEqual(back.warnings, []);
});

test('F2-05: a query that loads to a table or has a connection cannot be renamed', async () => {
  for (const [wb, name] of [[await openSimple(), 'StudentResults'], [await openWorkbook(generated('mixed.xlsm'), 'mixed.xlsm'), 'fGetNamedRange']]) {
    const cs = emptyChangeSet();
    cs.queries.rename.set(name, 'Other');
    await assert.rejects(() => applyChangeSet(wb, cs, { now: NOW }), (e) => e instanceof TypeError && /refused.renameLoaded/.test(e.message), name);
  }
});

test('F2-05: a query that other queries use cannot be renamed and the users are named', async () => {
  const { wb } = await reopenWith([['A', NEW_M], ['B', 'A + 1']]);
  const cs = emptyChangeSet();
  cs.queries.rename.set('A', 'C');
  await assert.rejects(() => applyChangeSet(wb, cs, { now: NOW }), (e) => e instanceof TypeError && /refused.referenced: B/.test(e.message));
  const ok = await renameIn(wb, [['B', 'C']]);
  assert.deepEqual(queryNames(ok.back), ['StudentResults', 'A', 'C']);
});

test('F2-05: a query that reads #shared blocks every rename', async () => {
  const { wb } = await reopenWith([['A', NEW_M], ['Reader', '#shared']]);
  const cs = emptyChangeSet();
  cs.queries.rename.set('A', 'C');
  await assert.rejects(() => applyChangeSet(wb, cs, { now: NOW }), (e) => e instanceof TypeError && /refused.referenced: Reader/.test(e.message));
});

test('F2-05: names that clash, cannot be written, or do not change are refused before anything is written', async () => {
  const { wb } = await reopenWith([['A', NEW_M], ['B', NEW_M]]);
  const cases = [[['A', 'b']], [['A', 'StudentResults']], [['A', '']], [['A', ' x']], [['A', 'A']], [['A', 'X'], ['B', 'x']]];
  for (const pairs of cases) {
    const cs = emptyChangeSet();
    for (const [from, to] of pairs) cs.queries.rename.set(from, to);
    await assert.rejects(() => applyChangeSet(wb, cs, { now: NOW }), TypeError, JSON.stringify(pairs));
  }
  const unknown = emptyChangeSet();
  unknown.queries.rename.set('Nope', 'X');
  await assert.rejects(() => applyChangeSet(wb, unknown, { now: NOW }), (e) => e.code === 'pq.unknown');
  const clash = emptyChangeSet();
  clash.queries.rename.set('A', 'X');
  clash.queries.remove.add('A');
  await assert.rejects(() => applyChangeSet(wb, clash, { now: NOW }), TypeError);
});

test('F2-05: a workbook whose metadata does not match its section cannot take a rename', async () => {
  const wb = await openSimple();
  const broken = await openWorkbook(await mismatchedOutput(wb), 'bad.xlsx');
  const cs = emptyChangeSet();
  cs.queries.rename.set('Extra', 'Other');
  await assert.rejects(() => applyChangeSet(broken, cs, { now: NOW }), (e) => e.code === 'pq.format');
});

test('F2-05: the same now gives the same bytes for a rename', async () => {
  const { wb } = await reopenWith([['A', NEW_M]]);
  const a = await renameIn(wb, [['A', 'B']]);
  const b = await renameIn(wb, [['A', 'B']]);
  assert.equal(sha(a.res.bytes), sha(b.res.bytes));
});

async function withSectionTail(tail) {
  const wb = await openSimple();
  const m = wb.mashup;
  const section = { text: `${m.section.text.replace(/\s+$/, '')}${tail}`, bom: m.section.bom };
  const encoded = base64Encode(await buildDataMashup(m.model, section));
  const pkg = wb.pkg.clone();
  await pkg.setText(m.part, applyEdits(m.text.text, [textContentEdit(parseXml(m.text.text, m.part).root, encoded)]), m.text);
  return openWorkbook(await pkg.write({ now: NOW }), 'tail.xlsx');
}

test('F2-03: trailing space after the last member is kept when a member is added and when it is removed', async () => {
  for (const tail of ['\r\n', '\r\n\r\n', ' \r\n']) {
    const wb = await withSectionTail(tail);
    assert.deepEqual(wb.warnings, []);
    const base = wb.mashup.section.text.slice(0, wb.mashup.section.text.length - tail.length);
    const { back } = await addTo(wb, [['Extra', NEW_M]]);
    const eol = '\r\n';
    assert.equal(back.mashup.section.text, `${base}${eol}${eol}shared Extra = let${eol}    Source = 1${eol}in${eol}    Source;${tail}`, JSON.stringify(tail));
    const gone = await removeFrom(back, ['Extra']);
    assert.equal(gone.back.mashup.section.text, wb.mashup.section.text, JSON.stringify(tail));
  }
});
