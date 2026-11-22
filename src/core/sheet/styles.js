import { parseXml, applyEdits, attributeEdit, escapeAttr } from '../xml.js';
import { QuoinError } from '../errors.js';

const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const TYPE_STYLES = `${NS_REL}/styles`;
const FORMAT_DATETIME = 'yyyy\\-mm\\-dd\\ hh:mm:ss';
const FORMAT_DURATION = '[h]:mm:ss';

const prefixOf = (element) => (element.name.includes(':') ? element.name.slice(0, element.name.indexOf(':') + 1) : '');

export async function appendStyles(pkg, rels) {
  const stylesRel = rels.items.find((r) => r.type === TYPE_STYLES && !r.external);
  if (!stylesRel) throw new QuoinError('check.part', 'no styles part', 'xl/workbook.xml');
  const stylesPart = stylesRel.target;
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
  const edits = [
    { start: fonts.closeStart, end: fonts.closeStart, replacement: '<font><b/><sz val="11"/><name val="Calibri"/></font>' },
    attributeEdit(fonts, 'count', String(fontId + 1)),
    { start: cellXfs.closeStart, end: cellXfs.closeStart, replacement: [xf(14), xf(datetimeFormat), xf(21), xf(durationFormat), xf(0, fontId)].join('') },
    attributeEdit(cellXfs, 'count', String(base + 5))
  ];
  if (created.length && numFmts && numFmts.selfClosing) throw new QuoinError('check.part', 'styles cannot take new styles', stylesPart);
  if (created.length && numFmts) edits.push({ start: numFmts.closeStart, end: numFmts.closeStart, replacement: created.join('') }, attributeEdit(numFmts, 'count', String(known.length + created.length)));
  else if (created.length) edits.push({ start: fonts.start, end: fonts.start, replacement: `<numFmts count="${created.length}">${created.join('')}</numFmts>` });
  const fragments = edits.filter((e) => e.start === e.end).map((e) => e.replacement);
  const next = applyEdits(text.text, edits);
  await pkg.setText(stylesPart, next, text);
  return { part: stylesPart, text: next, fragments, countElements: ['fonts', 'cellXfs', 'numFmts'], ids: { date: base, datetime: base + 1, time: base + 2, duration: base + 3, header: base + 4 } };
}

