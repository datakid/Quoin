import { tablesToXlsx } from '../../src/core/export/xlsx.js';

const CLOCK = new Date(2026, 10, 24, 12, 0, 0);
const table = (columns, rows) => ({ columns, rowCount: rows.length, cols: columns.map((_, i) => rows.map((r) => r[i])) });
const sales = (n) => table(['Region', 'Amount'], [['North', 10 * n], ['South', 20 * n], ['East', 30 * n]]);
const notes = table(['Region', 'Qty'], [['North', 1]]);
const noAmount = table(['Region', 'Qty'], [['North', 1], ['South', 2]]);
const book = (sheets) => tablesToXlsx(sheets.map(([name, t]) => ({ name, table: t })), 'en-US', { now: CLOCK });
const OLE = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);

export const WORKED_QUERY = 'Table.SelectColumns(Table.PromoteHeaders(Excel.CurrentWorkbook(){[Name="{unit.name}"]}[Content], [PromoteAllScalars=true]), {"Region", "Amount"})';
export const PINNED = ['sales-05.xlsx', 'sales-06.xlsx', 'sales-07.xlsx'];
export const MISSING_COLUMN = ['sales-09.xlsx', 'sales-10.xlsx'];

export const workedRecipe = (folder = 'books') => ({
  recipe: 'transform',
  v: 1,
  name: 'CleanSales',
  scope: { type: 'sheets', match: 'all' },
  overrides: PINNED.map((file) => ({ file, path: `${folder}/${file}`, units: ['Data'] })),
  query: { source: 'inline', m: WORKED_QUERY },
  output: { mode: 'newSheet', name: 'Clean' }
});

export async function workedExampleFiles() {
  const files = [];
  for (let i = 1; i <= 4; i++) files.push([`sales-0${i}.xlsx`, await book([['Data', sales(i)]])]);
  for (let i = 5; i <= 7; i++) files.push([`sales-0${i}.xlsx`, await book([['Data', sales(i)], ['Notes', notes]])]);
  files.push(['sales-08.xlsx', await book([['North', sales(8)], ['South', sales(8)]])]);
  files.push(['sales-09.xlsx', await book([['North', sales(9)], ['South', noAmount]])]);
  files.push(['sales-10.xlsx', await book([['North', sales(10)], ['South', noAmount]])]);
  files.push(['old-11.xls', OLE]);
  files.push(['old-12.xls', OLE]);
  return files;
}
