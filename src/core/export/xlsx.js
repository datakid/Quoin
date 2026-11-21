import { writeZip } from '../zip-write.js';
import { utf8Encode } from '../bytes.js';
import { sheetXml } from '../sheet/sheet-xml.js';
import { NameBook } from '../sheet/names.js';
import { escapeAttr } from '../xml.js';

export { MAX_ROWS, MAX_COLS } from './limits.js';

const ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd\\ hh:mm:ss"/><numFmt numFmtId="165" formatCode="[h]:mm:ss"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="21" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

export const STANDARD_STYLES = { date: 1, datetime: 2, time: 3, duration: 4, header: 5 };

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const contentTypes = (n) => `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${Array.from({ length: n }, (_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const workbookXml = (names) => `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL_NS}"><sheets>${names.map((name, i) => `<sheet name="${escapeAttr(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;

const workbookRels = (n) => `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${Array.from({ length: n }, (_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${n + 1}" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`;

export async function workbookFromSheets(sheets, { now } = {}) {
  const enc = (name, text) => ({ name, data: utf8Encode(text) });
  return writeZip([
    enc('[Content_Types].xml', contentTypes(sheets.length)),
    enc('_rels/.rels', ROOT_RELS),
    enc('xl/workbook.xml', workbookXml(sheets.map((s) => s.name))),
    enc('xl/_rels/workbook.xml.rels', workbookRels(sheets.length)),
    enc('xl/styles.xml', STYLES),
    ...sheets.map((s, i) => enc(`xl/worksheets/sheet${i + 1}.xml`, s.xml))
  ], now ? { now } : undefined);
}

export async function tableToXlsx(table, culture = 'en-US', { now } = {}) {
  return workbookFromSheets([{ name: 'Result', xml: sheetXml(table, culture, STANDARD_STYLES) }], { now });
}

export async function tablesToXlsx(tables, culture = 'en-US', options = {}) {
  const entries = tables.map((t) => (t && t.table ? t : { name: 'Result', table: t }));
  const book = new NameBook();
  return workbookFromSheets(entries.map((e) => ({ name: entries.length === 1 && e.name === 'Result' ? 'Result' : book.sheet(e.name), xml: sheetXml(e.table, culture, STANDARD_STYLES) })), options);
}
