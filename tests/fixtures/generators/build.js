import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip } from '../../../src/core/zip-read.js';
import { Package } from '../../../src/core/opc.js';
import { parseXml, applyEdits, textContentEdit } from '../../../src/core/xml.js';
import { base64Decode, base64Encode, concat, le32, utf8Encode } from '../../../src/core/bytes.js';
import { parseDataMashup, readSection } from '../../../src/core/pq/datamashup.js';
import { splitSection } from '../../../src/core/pq/section.js';
import * as h from './hostile.js';

const here = dirname(fileURLToPath(import.meta.url));
const ext = join(here, '..', 'external');
const out = join(here, '..', 'workbooks');
mkdirSync(out, { recursive: true });
const load = (name) => new Uint8Array(readFileSync(join(ext, name)));

export async function addQueries(bytes, queries) {
  const pkg = new Package(readZip(bytes));
  const t = await pkg.text('customXml/item1.xml');
  const doc = parseXml(t.text);
  const dm = parseDataMashup(base64Decode(doc.root.text()));
  const section = await readSection(dm);
  const first = splitSection(section.text).members.find((m) => m.shared);
  let newSection = section.text;
  let xml = dm.metadata.xml;
  const bom = xml.charCodeAt(0) === 0xFEFF;
  const mark = xml.indexOf(`Section1/${first.name}`);
  const at = xml.lastIndexOf('<Item>', mark);
  const end = xml.indexOf('</Item>', mark) + '</Item>'.length;
  const item = xml.slice(at, end);
  let clones = '';
  for (const [name, expression] of queries) {
    newSection += `\r\n\r\nshared ${name} = ${expression};`;
    clones += item.split(`Section1/${first.name}`).join(`Section1/${name}`).replace(/Type="FillEnabled" Value="l1"/, 'Type="FillEnabled" Value="l0"');
  }
  xml = xml.slice(0, end) + clones + xml.slice(end);
  const xmlBytes = utf8Encode(`${bom ? '\uFEFF' : ''}${xml}`);
  const metadata = concat([le32(0), le32(xmlBytes.length), xmlBytes, le32(dm.metadata.content.length), dm.metadata.content]);
  const { writeZip } = await import('../../../src/core/zip-write.js');
  const { rawFromEntry } = await import('../../../src/core/zip-write.js');
  const entries = dm.packageParts.entries.map((e) => (e.name === 'Formulas/Section1.m' ? { name: e.name, data: utf8Encode(`${section.bom ? '\uFEFF' : ''}${newSection}`) } : { name: e.name, raw: rawFromEntry(e) }));
  const packageBytes = await writeZip(entries);
  const mashup = concat([le32(0), le32(packageBytes.length), packageBytes, le32(dm.raw.permissions.length), dm.raw.permissions, le32(metadata.length), metadata, le32(dm.permissionBindings.length), dm.permissionBindings]);
  const text = applyEdits(t.text, [textContentEdit(doc.root, base64Encode(mashup))]);
  await pkg.setText('customXml/item1.xml', text, t);
  return pkg.write();
}

export async function addQuery(bytes, name, expression) {
  return addQueries(bytes, [[name, expression]]);
}

export function manyQueries() {
  const q = [];
  const regions = ['North', 'South', 'East', 'West'];
  const rows = (k) => Array.from({ length: 6 }, (_, i) => `{"${regions[(i + k) % 4]}", ${10 * (i + 1) + k}, #date(2024, 1, ${i + 1}), ${(i % 3) + 1}}`).join(', ');
  const table = (k) => `#table({"Region", "Amount", "Date", "Units"}, {${rows(k)}})`;
  for (let i = 1; i <= 12; i++) q.push([`Staging_${String(i).padStart(2, '0')}`, table(i)]);
  q.push(['Sales_Raw', table(40)]);
  q.push(['Sales_Clean', 'let\r\n    Source = Sales_Raw,\r\n    Promoted = Table.PromoteHeaders(Table.DemoteHeaders(Source)),\r\n    #"Changed Type" = Table.TransformColumnTypes(Promoted, {{"Region", type text}, {"Amount", type number}, {"Units", Int64.Type}}),\r\n    #"Filtered Rows" = Table.SelectRows(#"Changed Type", each [Amount] > 5),\r\n    #"Added Margin" = Table.AddColumn(#"Filtered Rows", "Margin", each [Amount] / [Units]),\r\n    #"Sorted Rows" = Table.Sort(#"Added Margin", {{"Region", Order.Ascending}}),\r\n    Result = Table.FirstN(#"Sorted Rows", 100)\r\nin\r\n    Result']);
  q.push(['Sales_Returns', 'Table.SelectRows(Sales_Raw, each [Units] < 3)']);
  q.push(['Sales_Summary', 'Table.Group(Sales_Clean, {"Region"}, {{"Total", each List.Sum([Amount]), type number}})']);
  q.push(['Sales_by_Region', 'Table.Group(Sales_Clean, {"Region"}, {{"Rows", each Table.RowCount(_), Int64.Type}})']);
  q.push(['Sales_Forecast', 'Table.AddColumn(Sales_Summary, "Forecast", each [Total] * 1.1)']);
  q.push(['Sales_Report', 'Table.Combine({Sales_Summary, Sales_by_Region})']);
  q.push(['fx_SalesYear', '(d as date) as number => Date.Year(d)']);
  q.push(['Sales_Broken', 'let\r\n    Source = Sales_Raw,\r\n    Bad = Table.SelectRows(Source, each [Amount] >)\r\nin\r\n    Bad']);
  q.push(['Check_Missing', 'let\r\n    Source = Table.RowCount(Missing_Query)\r\nin\r\n    Source']);
  q.push(['From_Sql', 'Sql.Database("server", "db")']);
  q.push(['From_File', 'Csv.Document(File.Contents("C:\\data\\input.csv"))']);
  for (let i = 1; i <= 6; i++) q.push([`fx_Helper${i}`, `(x as number) as number => x + ${i}`]);
  const layers = [[], [], [], []];
  let n = 0;
  const name = (l, i) => `L${l}_${String(i).padStart(3, '0')}`;
  for (let i = 0; i < 100; i++) {
    layers[0].push(name(1, i));
    q.push([name(1, i), `Table.SelectRows(Staging_${String((i % 12) + 1).padStart(2, '0')}, each [Amount] > ${i % 30})`]);
  }
  for (let i = 0; i < 90; i++) {
    layers[1].push(name(2, i));
    q.push([name(2, i), `Table.AddColumn(${layers[0][i]}, "Double", each [Amount] * 2)`]);
  }
  for (let i = 0; i < 60; i++) {
    layers[2].push(name(3, i));
    q.push([name(3, i), `Table.Combine({${layers[1][i]}, ${layers[1][i + 20]}})`]);
  }
  q.push(['Wide_Steps', `let\r\n    S1 = Staging_01,\r\n    S2 = Table.SelectRows(S1, each [Amount] > 0),\r\n    S3 = Table.AddColumn(S2, "A3", each [Amount] + 1),\r\n    S4 = Table.AddColumn(S3, "A4", each [Amount] + 2),\r\n    S5 = Table.AddColumn(S4, "A5", each [Amount] + 3),\r\n    S6 = Table.AddColumn(S5, "A6", each [Amount] + 4),\r\n    S7 = Table.AddColumn(S6, "A7", each [Amount] + 5),\r\n    S8 = Table.AddColumn(S7, "A8", each [Amount] + 6),\r\n    S9 = Table.AddColumn(S8, "A9", each [Amount] + 7),\r\n    S10 = Table.Sort(S9, {{"Amount", Order.Descending}}),\r\n    S11 = Table.Distinct(S10),\r\n    S12 = Table.FirstN(S11, 50)\r\nin\r\n    S12`]);
  while (q.length < 319) {
    q.push([name(4, n), `Table.RowCount(${layers[2][n % 60]})`]);
    n++;
  }
  return q;
}

export async function withSignature(bytes) {
  const pkg = new Package(readZip(bytes));
  pkg.set('xl/vbaProjectSignature.bin', Uint8Array.from([1, 2, 3, 4]));
  const relsName = 'xl/_rels/vbaProject.bin.rels';
  const rel = '<Relationship Id="rId9" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProjectSignature" Target="vbaProjectSignature.bin"/>';
  const rels = await pkg.text(relsName);
  if (rels) await pkg.setText(relsName, rels.text.replace('</Relationships>', `${rel}</Relationships>`), rels);
  else pkg.set(relsName, utf8Encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel}</Relationships>`));
  const ct = await pkg.text('[Content_Types].xml');
  await pkg.setText('[Content_Types].xml', ct.text.replace('</Types>', '<Override PartName="/xl/vbaProjectSignature.bin" ContentType="application/vnd.ms-office.vbaProjectSignature"/></Types>'), ct);
  return pkg.write();
}

export async function withVbaProject(bytes, bin) {
  const pkg = new Package(readZip(bytes));
  pkg.set('xl/vbaProject.bin', bin);
  return pkg.write();
}

export async function buildAll() {
  const complex = load('pq_vba_complex.xlsm');
  const files = {};
  files['mixed.xlsm'] = await withVbaProject(complex, load('xw_vbaProject05.bin'));
  files['signed.xlsm'] = await withSignature(files['mixed.xlsm']);
  files['encrypted.xlsx'] = h.encryptedOffice();
  files['csv-query.xlsx'] = await addQuery(load('pq_simple.xlsx'), 'Sales', 'let\r\n    Source = Csv.Document(File.Contents("C:\\data\\sales.csv"), [Delimiter=",", Encoding=65001]),\r\n    Promoted = Table.PromoteHeaders(Source),\r\n    Typed = Table.TransformColumnTypes(Promoted, {{"Units", Int64.Type}, {"Price", type number}})\r\nin\r\n    Typed');
  files['unsupported.xlsx'] = await addQuery(load('pq_simple.xlsx'), 'FromSql', 'Sql.Database("server", "db")');
  files['long-run.xlsx'] = await addQuery(load('pq_simple.xlsx'), 'Slow', 'List.Accumulate({1..100000}, 0, (s, c) => s + List.Sum({1..c}))');
  files['big-grid.xlsx'] = await addQuery(load('pq_simple.xlsx'), 'Big', 'let\r\n    Ids = List.Numbers(0, 1000000),\r\n    Cols = {Ids, Ids, Ids, Ids, Ids, Ids, Ids, Ids, Ids, Ids, Ids, Ids}\r\nin\r\n    Table.FromColumns(Cols, {"A","B","C","D","E","F","G","H","I","J","K","L"})');
  files['many-queries.xlsx'] = await addQueries(load('pq_simple.xlsx'), manyQueries());
  for (const [name, data] of Object.entries(files)) writeFileSync(join(out, name), data);
  writeFileSync(join(out, 'sales.csv'), 'Region,Units,Price\r\nNorth,10,2.5\r\nSouth,4,3.75\r\n"East, Coast",7,1.2\r\n');
  return Object.keys(files);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) buildAll().then((n) => console.log(n.join('\n')));
