import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runOnce } from '../../../src/core/m/engine.js';
import { workbookFromSheets, STANDARD_STYLES } from '../../../src/core/export/xlsx.js';
import { sheetXml } from '../../../src/core/sheet/sheet-xml.js';

export const WORKED_NOW = '2026-11-14T10:00:00.000Z';

export const SALES_TABLE = '#table({"Item", "Qty"}, {{"a", 1}, {"b", null}, {"c", 3}})';
export const MORE_TABLE = '#table({"Item", "Qty"}, {{"x", 7}, {"y", 8}})';
export const NO_QTY_TABLE = '#table({"Item", "Count"}, {{"x", 7}, {"y", 8}})';
export const CLEAN_SALES_M = 'let Raw = Excel.CurrentWorkbook(){[Name="{unit.name}"]}[Content], Promoted = Table.PromoteHeaders(Raw), Clean = Table.SelectRows(Promoted, each [Qty] <> null) in Clean';

const tableOf = (m) => runOnce({ sectionText: `section Section1;\r\n\r\nshared Result =\r\n${m};`, queryName: 'Result', now: WORKED_NOW, previewRows: 1 }).value;

async function workbook(sheets) {
  return workbookFromSheets(sheets.map(([name, m]) => ({ name, xml: sheetXml(tableOf(m), 'en-US', STANDARD_STYLES) })), { now: new Date(WORKED_NOW) });
}

export async function buildWorkedExample() {
  const files = [];
  for (let i = 1; i <= 7; i++) files.push({ name: `region${i}.xlsx`, relPath: `east/region${i}.xlsx`, bytes: await workbook([['Data', SALES_TABLE], ['Notes', MORE_TABLE]]) });
  for (let i = 1; i <= 3; i++) files.push({ name: `branch${i}.xlsx`, relPath: `west/branch${i}.xlsx`, bytes: await workbook([['Data', SALES_TABLE], ['Extra', i <= 2 ? NO_QTY_TABLE : MORE_TABLE]]) });
  files.push({ name: 'old1.xls', relPath: 'legacy/old1.xls', bytes: new Uint8Array([1, 2, 3]) }, { name: 'old2.xls', relPath: 'legacy/old2.xls', bytes: new Uint8Array([4, 5, 6]) });
  return files;
}

export async function writeWorkedExample(dir) {
  const files = await buildWorkedExample();
  for (const f of files) {
    const target = join(dir, f.relPath);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, f.bytes);
  }
  return files.map((f) => f.relPath);
}
