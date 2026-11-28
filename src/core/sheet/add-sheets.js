import { parseXml, applyEdits, attributeEdit, escapeAttr } from '../xml.js';
import { readContentTypes, readRelationships } from '../opc.js';
import { readUsedGrid } from '../cells.js';
import { utf8Encode } from '../bytes.js';
import { QuoinError } from '../errors.js';
import { sheetXml } from './sheet-xml.js';
import { sheetNameBase } from './names.js';
import { expectedGrid, sameGrid } from './grid.js';

const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const TYPE_WORKSHEET = `${NS_REL}/worksheet`;
const TYPE_STYLES = `${NS_REL}/styles`;
const CT_WORKSHEET = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
const FORMAT_DATETIME = 'yyyy\\-mm\\-dd\\ hh:mm:ss';
const FORMAT_DURATION = '[h]:mm:ss';

const lower = (text) => text.toLowerCase();
const prefixOf = (element) => (element.name.includes(':') ? element.name.slice(0, element.name.indexOf(':') + 1) : '');

function validateNames(wb, adds) {
  const taken = new Set(wb.sheets.map((s) => lower(s.name)));
  taken.add('history');
  for (const add of adds) {
    if (sheetNameBase(add.name) !== add.name) throw new TypeError(`not a usable sheet name: ${add.name}`);
    if (taken.has(lower(add.name))) throw new TypeError(`sheet name already used: ${add.name}`);
    taken.add(lower(add.name));
  }
}

function nextNumber(used, start) {
  let n = start;
  while (used.has(n)) n++;
  return n;
}

const fragmentOf = (base, edit) => (edit.start === edit.end ? edit.replacement : { from: base.slice(edit.start, edit.end), to: edit.replacement });

async function appendStyles(pkg, stylesPart) {
  const text = await pkg.text(stylesPart);
  const doc = parseXml(text.text, stylesPart);
  const root = doc.root;
  const fonts = root.child('fonts');
  const cellXfs = root.child('cellXfs');
  if (!fonts || !cellXfs || fonts.selfClosing || cellXfs.selfClosing || prefixOf(fonts) || prefixOf(cellXfs)) throw new QuoinError('check.part', 'styles cannot take new styles', stylesPart);
  const numFmts = root.child('numFmts');
  const known = numFmts ? numFmts.childrenNamed('numFmt') : [];
  let nextId = Math.max(163, ...known.map((f) => Number(f.attr('numFmtId')) || 0)) + 1;
  const created = [];
  const idFor = (code) => {
    const found = known.find((f) => f.attr('formatCode') === escapeAttr(code));
    if (found) return Number(found.attr('numFmtId'));
    const id = nextId++;
    created.push(`<numFmt numFmtId="${id}" formatCode="${escapeAttr(code)}"/>`);
    return id;
  };
  const datetimeFormat = idFor(FORMAT_DATETIME);
  const durationFormat = idFor(FORMAT_DURATION);
  const fontId = fonts.childrenNamed('font').length;
  const base = cellXfs.childrenNamed('xf').length;
  const xf = (numFmt, font = 0) => `<xf numFmtId="${numFmt}" fontId="${font}" fillId="0" borderId="0" xfId="0"${numFmt ? ' applyNumberFormat="1"' : ''}${font ? ' applyFont="1"' : ''}/>`;
  const inserts = [
    { start: fonts.closeStart, end: fonts.closeStart, replacement: '<font><b/><sz val="11"/><name val="Calibri"/></font>' },
    { start: cellXfs.closeStart, end: cellXfs.closeStart, replacement: [xf(14), xf(datetimeFormat), xf(21), xf(durationFormat), xf(0, fontId)].join('') }
  ];
  const counts = [attributeEdit(fonts, 'count', String(fontId + 1)), attributeEdit(cellXfs, 'count', String(base + 5))];
  const countElements = ['fonts', 'cellXfs'];
  if (created.length && numFmts && !numFmts.selfClosing) {
    inserts.push({ start: numFmts.closeStart, end: numFmts.closeStart, replacement: created.join('') });
    counts.push(attributeEdit(numFmts, 'count', String(known.length + created.length)));
    countElements.push('numFmts');
  } else if (created.length && numFmts) {
    inserts.push({ start: numFmts.start, end: numFmts.end, replacement: `<numFmts count="${known.length + created.length}">${created.join('')}</numFmts>` });
    countElements.push('numFmts');
  } else if (created.length) inserts.push({ start: fonts.start, end: fonts.start, replacement: `<numFmts count="${created.length}">${created.join('')}</numFmts>` });
  const next = applyEdits(text.text, [...inserts, ...counts]);
  await pkg.setText(stylesPart, next, text);
  return {
    ids: { date: base, datetime: base + 1, time: base + 2, duration: base + 3, header: base + 4 },
    text: next,
    insertion: { base: text.text, fragments: inserts.map((e) => fragmentOf(text.text, e)), countElements }
  };
}

export async function addSheetsToPackage(wb, pkg, adds) {
  validateNames(wb, adds);
  const touched = new Set();
  const addedParts = new Set();
  const rels = await readRelationships(pkg, wb.workbookPart);
  const stylesRel = rels.items.find((r) => r.type === TYPE_STYLES && !r.external);
  if (!stylesRel) throw new QuoinError('check.part', 'no styles part', wb.workbookPart);
  const written = await appendStyles(pkg, stylesRel.target);
  const styles = written.ids;
  const texts = new Map([[stylesRel.target, written.text]]);
  const insertions = new Map([[stylesRel.target, written.insertion]]);
  touched.add(stylesRel.target);

  const dir = wb.workbookPart.slice(0, wb.workbookPart.lastIndexOf('/') + 1);
  const usedNumbers = new Set();
  for (const name of pkg.names()) {
    const m = /(?:^|\/)worksheets\/sheet(\d+)\.xml$/i.exec(name);
    if (m) usedNumbers.add(Number(m[1]));
  }
  const wbText = await pkg.text(wb.workbookPart);
  const wbDoc = parseXml(wbText.text, wb.workbookPart);
  const sheetsEl = wbDoc.root.child('sheets');
  const existing = sheetsEl.childrenNamed('sheet');
  const usedIds = new Set(existing.map((s) => Number(s.attr('sheetId')) || 0));
  const relName = (existing.length && existing[0].attrs.find((a) => a.name.includes(':') && existing[0].resolvePrefix(a.name.slice(0, a.name.indexOf(':'))) === NS_REL && a.name.endsWith(':id'))) || null;
  const relAttr = relName ? relName.name : 'r:id';
  const usedRids = new Set(rels.items.map((r) => r.id));
  const sheetTags = [];
  const relTags = [];
  const typeTags = [];
  let number = 0;
  let sheetId = 0;
  let ridNumber = 0;
  for (const add of adds) {
    number = nextNumber(usedNumbers, number + 1);
    usedNumbers.add(number);
    sheetId = nextNumber(usedIds, sheetId + 1);
    usedIds.add(sheetId);
    ridNumber = ridNumber + 1;
    while (usedRids.has(`rId${ridNumber}`)) ridNumber++;
    const rid = `rId${ridNumber}`;
    usedRids.add(rid);
    const part = `${dir}worksheets/sheet${number}.xml`;
    pkg.set(part, utf8Encode(sheetXml(add.table, add.culture || 'en-US', styles)));
    addedParts.add(part);
    sheetTags.push(`<${prefixOf(sheetsEl)}sheet name="${escapeAttr(add.name)}" sheetId="${sheetId}" ${relAttr}="${rid}"/>`);
    relTags.push(`<Relationship Id="${rid}" Type="${TYPE_WORKSHEET}" Target="worksheets/sheet${number}.xml"/>`);
    typeTags.push(`<Override PartName="/${part}" ContentType="${CT_WORKSHEET}"/>`);
  }
  const sheetsInsert = sheetTags.join('');
  const wbNext = applyEdits(wbText.text, [{ start: sheetsEl.closeStart, end: sheetsEl.closeStart, replacement: sheetsInsert }]);
  await pkg.setText(wb.workbookPart, wbNext, wbText);
  texts.set(wb.workbookPart, wbNext);
  insertions.set(wb.workbookPart, { base: wbText.text, fragments: [sheetsInsert], countElements: [] });
  touched.add(wb.workbookPart);

  const relInsert = relTags.map((t) => t.replace('<Relationship ', `<${prefixOf(rels.doc.root)}Relationship `)).join('');
  const relNext = applyEdits(rels.text.text, [{ start: rels.doc.root.closeStart, end: rels.doc.root.closeStart, replacement: relInsert }]);
  await pkg.setText(rels.part, relNext, rels.text);
  texts.set(rels.part, relNext);
  insertions.set(rels.part, { base: rels.text.text, fragments: [relInsert], countElements: [] });
  touched.add(rels.part);

  const ct = await readContentTypes(pkg);
  const ctInsert = typeTags.map((t) => t.replace('<Override ', `<${prefixOf(ct.doc.root)}Override `)).join('');
  const ctNext = applyEdits(ct.text.text, [{ start: ct.doc.root.closeStart, end: ct.doc.root.closeStart, replacement: ctInsert }]);
  await pkg.setText('[Content_Types].xml', ctNext, ct.text);
  texts.set('[Content_Types].xml', ctNext);
  insertions.set('[Content_Types].xml', { base: ct.text.text, fragments: [ctInsert], countElements: [] });
  touched.add('[Content_Types].xml');
  return { touched, addedParts, texts, insertions };
}

export async function verifyAddedSheets(back, wb, adds) {
  const want = [...wb.sheets.map((s) => s.name), ...adds.map((a) => a.name)];
  if (JSON.stringify(back.sheets.map((s) => s.name)) !== JSON.stringify(want)) throw new QuoinError('check.part', 'sheet list differs after write', 'xl/workbook.xml');
  const types = await readContentTypes(back.pkg);
  for (const add of adds) {
    const grid = await readUsedGrid(back, add.name);
    if (!sameGrid(expectedGrid(add.table, add.culture || 'en-US'), grid)) throw new QuoinError('check.part', 'sheet differs after write', add.name);
    const sheet = back.sheets.find((x) => x.name === add.name);
    if (!sheet || !sheet.part || types.overrides.get(`/${sheet.part}`) !== CT_WORKSHEET) throw new QuoinError('check.part', 'new sheet has no content type', sheet && sheet.part ? sheet.part : add.name);
  }
}
