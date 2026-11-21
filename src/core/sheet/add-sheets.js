import { parseXml, applyEdits, escapeAttr } from '../xml.js';
import { readContentTypes, readRelationships } from '../opc.js';
import { readUsedGrid } from '../cells.js';
import { utf8Encode } from '../bytes.js';
import { QuoinError } from '../errors.js';
import { sheetXml } from './sheet-xml.js';
import { sheetNameBase } from './names.js';
import { expectedGrid, sameGrid } from './grid.js';
import { appendStyles } from './styles.js';

const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const TYPE_WORKSHEET = `${NS_REL}/worksheet`;
const CT_WORKSHEET = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';

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

export async function addSheetsToPackage(wb, pkg, adds) {
  validateNames(wb, adds);
  const touched = new Set();
  const addedParts = new Set();
  const rels = await readRelationships(pkg, wb.workbookPart);
  const added = await appendStyles(pkg, rels);
  const styles = added.ids;
  touched.add(added.part);

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
  await pkg.setText(wb.workbookPart, applyEdits(wbText.text, [{ start: sheetsEl.closeStart, end: sheetsEl.closeStart, replacement: sheetTags.join('') }]), wbText);
  touched.add(wb.workbookPart);

  const relEdit = { start: rels.doc.root.closeStart, end: rels.doc.root.closeStart, replacement: relTags.map((t) => t.replace('<Relationship ', `<${prefixOf(rels.doc.root)}Relationship `)).join('') };
  await pkg.setText(rels.part, applyEdits(rels.text.text, [relEdit]), rels.text);
  touched.add(rels.part);

  const ct = await readContentTypes(pkg);
  await pkg.setText('[Content_Types].xml', applyEdits(ct.text.text, [{ start: ct.doc.root.closeStart, end: ct.doc.root.closeStart, replacement: typeTags.map((t) => t.replace('<Override ', `<${prefixOf(ct.doc.root)}Override `)).join('') }]), ct.text);
  touched.add('[Content_Types].xml');
  return { touched, addedParts };
}

export async function verifyAddedSheets(back, wb, adds) {
  const want = [...wb.sheets.map((s) => s.name), ...adds.map((a) => a.name)];
  if (JSON.stringify(back.sheets.map((s) => s.name)) !== JSON.stringify(want)) throw new QuoinError('check.part', 'sheet list differs after write', 'xl/workbook.xml');
  for (const add of adds) {
    const grid = await readUsedGrid(back, add.name);
    if (!sameGrid(expectedGrid(add.table, add.culture || 'en-US'), grid)) throw new QuoinError('check.part', 'sheet differs after write', add.name);
  }
}
