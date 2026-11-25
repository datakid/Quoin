import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { openWorkbook } from '../src/core/workbook.js';
import { indexWorkbook } from '../src/batch/index/file-index.js';
import { parseRecipe } from '../src/batch/recipe/recipe.js';
import { resolvePlan } from '../src/batch/resolve/resolve.js';
import { executeFile } from '../src/batch/execute/index.js';
import { sha256Bytes } from '../src/batch/index/hash.js';
import { writeZip } from '../src/core/zip-write.js';
import { workbookFromSheets } from '../src/core/export/xlsx.js';

export const SCOPE_PACK_NOW = '2026-11-14T10:00:00.000Z';
const FIXTURES = fileURLToPath(new URL('../tests/fixtures/external/', import.meta.url));
const fixtureBytes = (name) => new Uint8Array(readFileSync(join(FIXTURES, name)));
const encode = (text) => new TextEncoder().encode(text);

const OPENS_INPUT = 'The input opens in Excel with no message. Click Enable Editing if Protected View appears.';
const OPENS_OUTPUT = 'The output opens with no repair, recovery or "unreadable content" message.';
const SAVES = 'File > Save As, under a new name, works with no message, and the saved copy opens again.';
const REFRESHES = '[needs refresh] Data > Refresh All finishes with no error message.';
const COMPILES = '[needs VBA editor] In the VBA editor (Alt+F11), Debug > Compile VBAProject finishes with no error.';

const X01_M = ['let', '    Source = Excel.CurrentWorkbook(){[Name="{unit.name}"]}[Content],', '    Older = Table.SelectRows(Source, each [Age] >= 30),', '    Stamped = Table.AddColumn(Older, "Refreshed", each DateTime.LocalNow())', 'in', '    Stamped'].join('\n');
const X02_M = ['let', '    Raw = Excel.CurrentWorkbook(){[Name="{unit.name}"]}[Content],', '    Tagged = Table.AddColumn(Raw, "Pack", each "Quoin pack X02")', 'in', '    Tagged'].join('\n');
const X03_M = 'Excel.CurrentWorkbook(){[Name="{unit.name}"]}[Content]';

const SHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const FORMULA_SHEET = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${SHEET_NS}"><dimension ref="A1:C3"/><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1" t="inlineStr"><is><t>left</t></is></c></row><row r="2"><c r="A2"><v>2</v></c><c r="B2" t="inlineStr"><is><t>merged here</t></is></c></row><row r="3"><c r="A3"><f>SUM(A1:A2)</f><v>3</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="B2:C2"/></mergeCells></worksheet>`;

async function run(bytes, name, json, extra = {}) {
  const recipe = parseRecipe(JSON.stringify(json)).recipe;
  const index = await indexWorkbook(bytes, { id: 'f1', name, relPath: name, size: bytes.length });
  const plan = resolvePlan(recipe, [index], { now: SCOPE_PACK_NOW });
  const wb = await openWorkbook(bytes, name);
  const result = await executeFile(wb, plan.files[0], { now: SCOPE_PACK_NOW, recipe, meta: index, runId: 'excel-pack-scope', ...extra });
  return { recipe, plan, result };
}

function verified(id, { result }) {
  const bad = result.rows.filter((r) => !(r.verdict === 'changed' && r.verified));
  if (!result.bytes || bad.length) throw new Error(`${id}: not a verified change: ${JSON.stringify(result.rows.map((r) => [r.verdict, r.reason_code, r.verified]))}`);
  return result.bytes;
}

const summary = (rows) => rows.map((r) => ({ unit: r.unit, action: r.action, compute: r.compute, verdict: r.verdict, verified: r.verified, output: r.output, old_hash: r.old_hash, new_hash: r.new_hash }));

const transform = (compute, scope, m, output) => ({ recipe: 'transform', v: 1, compute, scope, query: { source: 'inline', m }, output });

async function excelCase(id, file, scope, m, target, expects) {
  const input = fixtureBytes(file);
  const onOpen = await run(input, file, transform('excel', scope, m, { mode: 'inPlace', name: target }));
  const outBytes = verified(id, onOpen);
  const files = [{ name: `${id}/input${file.slice(file.lastIndexOf('.'))}`, data: input }, { name: `${id}/output${file.slice(file.lastIndexOf('.'))}`, data: outBytes }];
  const quoin = await run(input, file, transform('quoin', scope, m, { mode: 'newFile', name: 'expected-by-quoin.xlsx' }));
  const expected = quoin.result.outputs[0];
  files.push({ name: `${id}/expected-by-quoin.xlsx`, data: expected.bytes });
  files.push({ name: `${id}/what-quoin-reported.json`, data: encode(JSON.stringify({ excelOnOpen: summary(onOpen.result.rows), quoinNow: summary(quoin.result.rows) }, null, 2)) });
  return { id, expects, files, hash: await sha256Bytes(outBytes) };
}

export async function buildScopePack() {
  const cases = [];
  cases.push(await excelCase('X01', 'pq_simple.xlsx', { type: 'tables', match: 'pattern', pattern: 'StudentNames' }, X01_M, 'StudentResults', [
    OPENS_INPUT, OPENS_OUTPUT,
    '[needs refresh] Data > Queries & Connections: StudentResults now shows the new query text (it reads the table StudentNames and keeps people aged 30 or more).',
    REFRESHES,
    '[needs refresh] On the StudentResults sheet the table lists the same people and ages as the sheet "Result" of expected-by-quoin.xlsx. The column Refreshed shows the time you refreshed, not 2026-11-14.',
    '[needs refresh] Close the output without saving, open it again and wait: the table refreshes by itself on open, and Refreshed changes.',
    SAVES
  ]));
  cases.push(await excelCase('X02', 'pq_vba_complex.xlsm', { type: 'tables', match: 'pattern', pattern: 'RawInput' }, X02_M, 'FinalTable', [
    OPENS_INPUT, OPENS_OUTPUT, COMPILES,
    '[needs VBA editor] The macros are still in the workbook: Alt+F8 lists them and the document modules ThisWorkbook and Sheet1 are intact.',
    REFRESHES,
    '[needs refresh] On sheet Input the table FinalTable has the columns of RawInput plus a column Pack that holds "Quoin pack X02" in every row, and its contents equal the sheet "Result" of expected-by-quoin.xlsx.',
    '[needs refresh] The query fGetNamedRange and the table RawInput are unchanged and RawInput still refreshes.',
    SAVES
  ]));
  const held = await workbookFromSheets([{ name: 'Sheet1', xml: FORMULA_SHEET }], { now: new Date(SCOPE_PACK_NOW) });
  const placed = await run(held, 'formulas.xlsx', transform('quoin', { type: 'sheets', match: 'all' }, X03_M, { mode: 'inPlace', range: 'E1' }), { allowInPlace: true });
  cases.push({
    id: 'X03',
    held: true,
    expects: [
      'Run this one only after X01 and X02 have passed: the plan holds in-place output until the other modes have been checked.',
      OPENS_INPUT, OPENS_OUTPUT,
      'A3 still shows 3 and changes to 6 if you type 4 in A2. The merged cell B2:C2 is still merged and still shows "merged here".',
      'From E1 on Sheet1 there is a small table: a first row Column1, Column2 and below it the values 1, left, 2, merged here and the formula result 3. Nothing else on the sheet moved.',
      SAVES
    ],
    files: [{ name: 'X03/input.xlsx', data: held }, { name: 'X03/output.xlsx', data: verified('X03', placed) }, { name: 'X03/what-quoin-reported.json', data: encode(JSON.stringify(summary(placed.result.rows), null, 2)) }],
    hash: await sha256Bytes(placed.result.bytes)
  });
  const lines = ['# Real-Excel pack, part 2: Excel compute and in place', '', 'Written by Scope. Nothing here has been run in real Excel. Do not mark a case as verified for anyone who has not opened it. This pack adds to `make-excel-pack.mjs`; the cases there stay in that pack.', '', 'Tick a box only when you saw it happen. Write what you saw in the line under the case if something differs.', '', 'Which Excel can do what. Opening a file, saving it, formulas and merged cells: any desktop Excel, and Excel for the web can open and look. Lines marked [needs refresh] need desktop Excel with Power Query: certain on Windows, depends on the version on a Mac, and Excel for the web cannot refresh queries. Lines marked [needs VBA editor] need desktop Excel on Windows or Mac. If a button is missing or a line cannot be done on your Excel, leave the box empty and write "cannot do on this Excel" instead of guessing.', ''];
  for (const c of cases) {
    lines.push(`## ${c.id}${c.held ? ' (hold: after X01 and X02)' : ''}`, '', `Files: \`${c.id}/\`. SHA-256 of the output: \`${c.hash}\`.`, '');
    for (const e of c.expects) lines.push(`- [ ] ${e}`);
    lines.push('', 'Saw:', '');
  }
  const entries = [...cases.flatMap((c) => c.files), { name: 'CHECKLIST-SCOPE.md', data: encode(lines.join('\n')) }];
  const zip = await writeZip(entries, { now: new Date(SCOPE_PACK_NOW) });
  return { zip, checklist: lines.join('\n'), cases, entries };
}

async function main() {
  const flag = process.argv.indexOf('--out');
  const dir = resolve(flag > 0 ? process.argv[flag + 1] : 'excel-pack-scope');
  const pack = await buildScopePack();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'quoin-excel-pack-scope.zip'), pack.zip);
  writeFileSync(join(dir, 'CHECKLIST-SCOPE.md'), pack.checklist);
  process.stdout.write(`${pack.cases.length} cases, ${pack.entries.length} files\n${join(dir, 'quoin-excel-pack-scope.zip')}\n${join(dir, 'CHECKLIST-SCOPE.md')}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
