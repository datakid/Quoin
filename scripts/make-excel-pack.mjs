import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { openWorkbook } from '../src/core/workbook.js';
import { applyChangeSet, emptyChangeSet } from '../src/core/save.js';
import { runOnce } from '../src/core/m/engine.js';
import { indexWorkbook } from '../src/batch/index/file-index.js';
import { parseRecipe } from '../src/batch/recipe/recipe.js';
import { resolvePlan } from '../src/batch/resolve/resolve.js';
import { executeFile } from '../src/batch/execute/index.js';
import { combineOutputs } from '../src/batch/execute/combine.js';
import { zipClock } from '../src/batch/execute/collect.js';
import { sha256Bytes } from '../src/batch/index/hash.js';
import { writeZip } from '../src/core/zip-write.js';

export const PACK_NOW = '2026-11-14T10:00:00.000Z';
const FIXTURES = fileURLToPath(new URL('../tests/fixtures/external/', import.meta.url));
const fixtureBytes = (name) => new Uint8Array(readFileSync(join(FIXTURES, name)));
const encode = (text) => new TextEncoder().encode(text);
const extOf = (name) => (/\.xlsm$/i.test(name) ? 'xlsm' : 'xlsx');

const SCOPE = { type: 'workbook', match: 'all', excludeHidden: true };

const OPENS_INPUT = 'The input opens in Excel with no message. Click Enable Editing if Protected View appears.';
const OPENS_OUTPUT = 'The output opens with no repair, recovery or "unreadable content" message.';
const SAVES = 'File > Save As, under a new name, works with no message, and the saved copy opens again.';
const REFRESHES = 'Data > Refresh All finishes with no error message.';
const COMPILES = 'In the VBA editor (Alt+F11), Debug > Compile VBAProject finishes with no error.';

async function runRecipe(bytes, name, json, extra = {}) {
  const recipe = parseRecipe(JSON.stringify(json)).recipe;
  const index = await indexWorkbook(bytes, { id: 'f1', name, relPath: name, size: bytes.length });
  const plan = resolvePlan(recipe, [index], { now: PACK_NOW });
  const wb = await openWorkbook(bytes, name);
  const result = await executeFile(wb, plan.files[0], { now: PACK_NOW, recipe, meta: index, runId: 'excel-pack', ...extra });
  return { recipe, plan, result };
}

function changed(id, run, { others = [] } = {}) {
  const { result } = run;
  if (!result.bytes) throw new Error(`${id}: no output was written: ${JSON.stringify(result.rows.map((r) => [r.verdict, r.reason_code]))}`);
  const bad = result.rows.filter((r) => !(r.verdict === 'changed' && r.verified) && !others.includes(r.verdict));
  if (bad.length) throw new Error(`${id}: a row is not a verified change: ${JSON.stringify(bad.map((r) => [r.verdict, r.reason_code]))}`);
  if (!result.rows.some((r) => r.verdict === 'changed' && r.verified)) throw new Error(`${id}: nothing was changed`);
  return result.bytes;
}

const summary = (rows) => rows.map((r) => ({ unit: r.unit, action: r.action, verdict: r.verdict, verified: r.verified, old_hash: r.old_hash, new_hash: r.new_hash, signature_removed: r.signature_removed }));

const inject = (over) => ({ recipe: 'inject', v: 1, scope: SCOPE, inject: { target: 'query', op: 'add', match: 'name', source: 'inline', refreshOnLoad: false, ...over } });
const replaceIn = (over) => ({ recipe: 'replace', v: 1, scope: SCOPE, replace: { in: ['m', 'vba'], kind: 'text', matchCase: true, ...over } });

const REPLACED_M = [
  'let',
  '    Source = Excel.CurrentWorkbook(){[Name="StudentNames"]}[Content],',
  '    #"Changed Type" = Table.TransformColumnTypes(Source,{{"Name", type text}, {"Age", Int64.Type}}),',
  '    #"Added Custom" = Table.AddColumn(#"Changed Type", "DateTimeGenerated", each DateTime.LocalNow()),',
  '    #"Added Version" = Table.AddColumn(#"Added Custom", "Version", each "Quoin pack Q01")',
  'in',
  '    #"Added Version"'
].join('\n');

const COPY_M = ['let', '    Source = Excel.CurrentWorkbook(){[Name="StudentNames"]}[Content]', 'in', '    Source'].join('\n');
const AWKWARD = ['Totals (2026)', 'Résumé 2026', 'a.b', 'q1_2026'];
const MACRO_REPLACED = 'Sub Macro1()\n    MsgBox "Macro1 replaced by Quoin"\nEnd Sub\n';
const MACRO_ADDED = 'Sub QuoinAdded()\n    MsgBox "Added by Quoin"\nEnd Sub\n';

const textTransform = (output) => ({ recipe: 'transform', v: 1, scope: { type: 'tables', match: 'all' }, query: { source: 'inline', m: 'Excel.CurrentWorkbook(){[Name="{unit.name}"]}[Content]' }, output, more: { culture: 'en-US' } });

async function buildQueryCases() {
  const baseName = 'pq_simple.xlsx';
  const base = fixtureBytes(baseName);
  const cases = [];
  const q01 = await runRecipe(base, baseName, inject({ op: 'replace', name: 'StudentResults', text: REPLACED_M, refreshOnLoad: true, target: 'query' }));
  cases.push({
    id: 'Q01', slug: 'replace-query', title: 'Replace the text of a query', group: 'Queries',
    did: 'Replaced the text of the query StudentResults with a version that adds a column Version, and set it to refresh when the file opens.',
    input: { name: `input.${extOf(baseName)}`, bytes: base }, outputs: [{ name: 'output.xlsx', bytes: changed('Q01', q01) }], rows: summary(q01.result.rows),
    checks: [OPENS_INPUT, OPENS_OUTPUT, 'Data > Queries & Connections lists StudentResults. Double-click it: the Advanced Editor shows a step called "Added Version".', REFRESHES, 'On the sheet StudentResults the table has a column Version filled with "Quoin pack Q01".', 'The table StudentNames on the sheet Input is unchanged.', SAVES]
  });
  const q02 = await runRecipe(base, baseName, inject({ op: 'add', name: 'Student Names Copy', text: COPY_M }));
  const q02Bytes = changed('Q02', q02);
  cases.push({
    id: 'Q02', slug: 'add-query', title: 'Add a query', group: 'Queries',
    did: 'Added a connection-only query called "Student Names Copy" that reads the table StudentNames. No table, sheet or connection was created.',
    input: { name: `input.${extOf(baseName)}`, bytes: base }, outputs: [{ name: 'output.xlsx', bytes: q02Bytes }], rows: summary(q02.result.rows),
    checks: [OPENS_INPUT, OPENS_OUTPUT, 'Data > Queries & Connections lists "Student Names Copy" next to StudentResults.', 'Double-click "Student Names Copy": the editor opens and the preview shows the columns Name and Age.', 'Right-click it > Load To... > Table loads the data into a new sheet with no error.', REFRESHES, SAVES]
  });
  let awkward = base;
  const awkwardRows = [];
  for (const name of AWKWARD) {
    const run = await runRecipe(awkward, baseName, inject({ op: 'add', name, text: COPY_M }));
    awkward = changed('Q03', run);
    awkwardRows.push(...summary(run.result.rows));
  }
  cases.push({
    id: 'Q03', slug: 'add-awkward-names', title: 'Add queries whose names need quoting or escaping', group: 'Queries',
    did: `Added four connection-only queries named ${AWKWARD.map((n) => `"${n}"`).join(', ')}.`,
    input: { name: `input.${extOf(baseName)}`, bytes: base }, outputs: [{ name: 'output.xlsx', bytes: awkward }], rows: awkwardRows,
    checks: [OPENS_INPUT, OPENS_OUTPUT, `Data > Queries & Connections lists all four names exactly as written: ${AWKWARD.join(' | ')}.`, 'Double-click each of the four: the editor opens and shows data. Write down any name Excel changes or refuses.', REFRESHES, SAVES]
  });
  const q04 = await runRecipe(q02Bytes, 'q02-output.xlsx', inject({ op: 'remove', name: 'Student Names Copy' }));
  cases.push({
    id: 'Q04', slug: 'remove-query', title: 'Remove a query that Quoin added', group: 'Queries',
    did: 'Removed "Student Names Copy" from the output of Q02. Quoin only removes a query that has no connection and loads nowhere.',
    note: 'The input of this case is the output of Q02.',
    input: { name: 'input.xlsx', bytes: q02Bytes }, outputs: [{ name: 'output.xlsx', bytes: changed('Q04', q04) }], rows: summary(q04.result.rows),
    checks: [OPENS_INPUT, OPENS_OUTPUT, 'Data > Queries & Connections lists only StudentResults.', 'Data > Queries & Connections > Connections tab (or Workbook Connections) has no "Student Names Copy".', REFRESHES, SAVES]
  });
  const q05 = await runRecipe(q02Bytes, 'q02-output.xlsx', inject({ op: 'rename', name: 'Student Names Copy', newName: 'Renamed By Quoin', text: undefined }));
  cases.push({
    id: 'Q05', slug: 'rename-query', title: 'Rename a query that Quoin added', group: 'Queries',
    did: 'Renamed "Student Names Copy" to "Renamed By Quoin" in the output of Q02.',
    note: 'The input of this case is the output of Q02.',
    input: { name: 'input.xlsx', bytes: q02Bytes }, outputs: [{ name: 'output.xlsx', bytes: changed('Q05', q05) }], rows: summary(q05.result.rows),
    checks: [OPENS_INPUT, OPENS_OUTPUT, 'Data > Queries & Connections lists "Renamed By Quoin" and does not list "Student Names Copy".', 'Double-click "Renamed By Quoin": the editor opens and the preview shows the columns Name and Age.', REFRESHES, SAVES]
  });
  const q06 = await runRecipe(base, baseName, replaceIn({ in: ['m'], find: 'DateTime.LocalNow()', with: 'DateTime.FixedLocalNow()' }));
  cases.push({
    id: 'Q06', slug: 'replace-text-in-query', title: 'Replace text inside query code', group: 'Queries',
    did: 'Replaced DateTime.LocalNow() with DateTime.FixedLocalNow() in every query.',
    input: { name: `input.${extOf(baseName)}`, bytes: base }, outputs: [{ name: 'output.xlsx', bytes: changed('Q06', q06, { others: ['unchanged'] }) }], rows: summary(q06.result.rows),
    checks: [OPENS_INPUT, OPENS_OUTPUT, 'StudentResults in the Advanced Editor contains DateTime.FixedLocalNow() and no DateTime.LocalNow().', REFRESHES, SAVES]
  });
  return cases;
}

async function buildMacroCases() {
  const baseName = 'xw_macro01.xlsm';
  const base = fixtureBytes(baseName);
  const cases = [];
  const m01 = await runRecipe(base, baseName, inject({ target: 'module', op: 'replace', name: 'Module1', text: MACRO_REPLACED }));
  cases.push({
    id: 'M01', slug: 'replace-module', title: 'Replace the code of a module', group: 'Macros',
    did: 'Replaced the code of Module1 (the procedure Macro1) with a version that shows a message box.',
    input: { name: `input.${extOf(baseName)}`, bytes: base }, outputs: [{ name: 'output.xlsm', bytes: changed('M01', m01) }], rows: summary(m01.result.rows),
    checks: [OPENS_INPUT, OPENS_OUTPUT, 'Alt+F11: the project lists Module1, ThisWorkbook and Sheet1, and Module1 holds the new code.', COMPILES, 'Alt+F8, run Macro1: a message box says "Macro1 replaced by Quoin".', SAVES]
  });
  const m02 = await runRecipe(base, baseName, inject({ target: 'module', op: 'add', name: 'Module2', text: MACRO_ADDED }));
  cases.push({
    id: 'M02', slug: 'add-module', title: 'Add a standard module', group: 'Macros',
    did: 'Added a standard module called Module2 with the procedure QuoinAdded.',
    input: { name: `input.${extOf(baseName)}`, bytes: base }, outputs: [{ name: 'output.xlsm', bytes: changed('M02', m02) }], rows: summary(m02.result.rows),
    checks: [OPENS_INPUT, OPENS_OUTPUT, 'Alt+F11: Module2 is listed under Modules and holds the procedure QuoinAdded. Module1 is still there.', COMPILES, 'Alt+F8, run QuoinAdded: a message box says "Added by Quoin". Run Macro1: cell A1 becomes 123.', 'File > Save As .xlsm, close and reopen: both modules are still there.']
  });
  const m03 = await runRecipe(base, baseName, inject({ target: 'module', op: 'remove', name: 'Module1' }));
  cases.push({
    id: 'M03', slug: 'remove-module', title: 'Remove a standard module', group: 'Macros',
    did: 'Removed the standard module Module1. The sheet and workbook modules are left alone.',
    input: { name: `input.${extOf(baseName)}`, bytes: base }, outputs: [{ name: 'output.xlsm', bytes: changed('M03', m03) }], rows: summary(m03.result.rows),
    checks: [OPENS_INPUT, OPENS_OUTPUT, 'Alt+F11: Module1 is gone; ThisWorkbook and Sheet1 remain and the Modules folder is empty or absent.', COMPILES, 'Alt+F8: Macro1 is no longer listed.', 'File > Save As .xlsm, close and reopen: the project is unchanged.']
  });
  const m04 = await runRecipe(base, baseName, replaceIn({ in: ['vba'], find: '"123"', with: '"456"' }));
  cases.push({
    id: 'M04', slug: 'replace-text-in-module', title: 'Replace text inside macro code', group: 'Macros',
    did: 'Replaced "123" with "456" in the code of every module.',
    input: { name: `input.${extOf(baseName)}`, bytes: base }, outputs: [{ name: 'output.xlsm', bytes: changed('M04', m04, { others: ['unchanged'] }) }], rows: summary(m04.result.rows),
    checks: [OPENS_INPUT, OPENS_OUTPUT, 'Alt+F11: Module1 contains "456" and no "123".', COMPILES, 'Alt+F8, run Macro1: cell A1 becomes 456.', SAVES]
  });
  return cases;
}

async function buildSignedCases() {
  const baseName = 'xw_macro04.xlsm';
  const base = fixtureBytes(baseName);
  const signedChecks = (specific) => [
    OPENS_INPUT,
    'Alt+F11 > Tools > Digital Signature: the input shows a certificate name (it is signed).',
    OPENS_OUTPUT,
    'Alt+F11 > Tools > Digital Signature on the output shows "No certificate": Quoin removed the signature and said so.',
    ...specific,
    SAVES
  ];
  const acknowledged = { acknowledgeSignature: true };
  const m05 = await runRecipe(base, baseName, inject({ target: 'module', op: 'replace', name: 'Module1', text: 'Sub say_hello()\n    MsgBox "Hello from Quoin"\nEnd Sub\n' }), acknowledged);
  const m06 = await runRecipe(base, baseName, inject({ target: 'module', op: 'add', name: 'Module2', text: MACRO_ADDED }), acknowledged);
  const m07 = await runRecipe(base, baseName, inject({ target: 'module', op: 'remove', name: 'Module1' }), acknowledged);
  const mk = (id, slug, title, did, run, specific) => ({
    id, slug, title, group: 'Signed macro projects', did, input: { name: `input.${extOf(baseName)}`, bytes: base }, outputs: [{ name: 'output.xlsm', bytes: changed(id, run) }], rows: summary(run.result.rows), checks: signedChecks(specific)
  });
  return [
    mk('M05', 'signed-replace-module', 'Replace a module in a signed project', 'Replaced the code of say_hello in Module1, after confirming that the signature is lost.', m05, [COMPILES, 'Alt+F8, run say_hello: a message box says "Hello from Quoin".']),
    mk('M06', 'signed-add-module', 'Add a module to a signed project', 'Added Module2, after confirming that the signature is lost.', m06, ['Alt+F11: Module2 is listed with the procedure QuoinAdded.', COMPILES, 'Alt+F8, run QuoinAdded and say_hello: both show a message.']),
    mk('M07', 'signed-remove-module', 'Remove a module from a signed project', 'Removed Module1, after confirming that the signature is lost.', m07, ['Alt+F11: Module1 is gone; ThisWorkbook and Sheet1 remain.', COMPILES])
  ];
}

async function buildProtectedCase() {
  const baseName = 'xw_macro01.xlsm';
  const base = fixtureBytes(baseName);
  const recipe = inject({ target: 'module', op: 'add', name: 'Module2', text: MACRO_ADDED });
  return {
    id: 'M08', slug: 'protected-project', title: 'A project locked for viewing must be refused', group: 'Macros', manual: true,
    did: 'Nothing: this case needs a file you make in Excel. Quoin must refuse to change a project that is locked for viewing and write nothing.',
    note: 'Open input.xlsm in Excel, press Alt+F11, Tools > VBAProject Properties > Protection, tick "Lock project for viewing", set a password, press OK, save as protected.xlsm, close Excel. Then give protected.xlsm to Quoin with recipe.json (add a module). recipe.json is in this folder.',
    input: { name: `input.${extOf(baseName)}`, bytes: base },
    outputs: [],
    extra: [{ name: 'recipe.json', bytes: encode(`${JSON.stringify(recipe, null, 2)}\n`) }],
    rows: [],
    checks: ['The unprotected input opens with no message.', 'After you lock it: the saved protected.xlsm opens and asks for the password only when you open the project.', 'Quoin refuses the file with the reason that the project is locked, and writes no output file.', 'protected.xlsm, opened again, is exactly as you saved it (Quoin changed nothing).']
  };
}

async function buildTransformCases() {
  const baseName = 'pq_simple.xlsx';
  const base = fixtureBytes(baseName);
  const cases = [];
  const file = await runRecipe(base, baseName, textTransform({ mode: 'newFile' }));
  if (!file.result.outputs || file.result.outputs.length !== 2) throw new Error('T01: expected two outputs');
  cases.push({
    id: 'T01', slug: 'new-file-per-unit', title: 'Result as a new file per table', group: 'Results',
    did: 'Wrote the table StudentNames and the table StudentResults each into its own new workbook with one sheet called Result and plain values only.',
    input: { name: `input.${extOf(baseName)}`, bytes: base }, outputs: file.result.outputs.map((o) => ({ name: o.name, bytes: o.bytes })), rows: summary(file.result.rows),
    checks: [OPENS_INPUT, 'Both output files open with no repair or recovery message.', 'Each has exactly one sheet, called Result, with a header row and the data of its table.', 'Data > Queries & Connections is empty and no cell holds a formula: the values are plain.', 'The column Age holds numbers (right-aligned) and the column DateTimeGenerated holds real dates and times, not text.', SAVES]
  });
  const sheet = await runRecipe(base, baseName, textTransform({ mode: 'newSheet' }));
  cases.push({
    id: 'T02', slug: 'new-sheet-in-copy', title: 'Result as new sheets in a copy of the workbook', group: 'Results',
    did: 'Made a copy of the workbook and added one sheet per table after the existing sheets, with the values of that table.',
    input: { name: `input.${extOf(baseName)}`, bytes: base }, outputs: [{ name: 'output.xlsx', bytes: changed('T02', sheet) }], rows: summary(sheet.result.rows),
    checks: [OPENS_INPUT, OPENS_OUTPUT, 'The workbook has its two original sheets (Input, StudentResults) and then two new sheets called Result and Result-2, each with a header row and data.', 'The original sheets, their tables and the query StudentResults are unchanged. Cell formats on the original sheets look the same as in the input.', 'On the original sheets, dates and numbers still show the same values (compare a date column with the input).', REFRESHES, SAVES]
  });
  const combinedInput = await runRecipe(base, baseName, textTransform({ mode: 'combined' }));
  const combined = await combineOutputs([combinedInput.result], { now: zipClock(PACK_NOW) });
  if (!combined.bytes) throw new Error('T03: nothing was combined');
  cases.push({
    id: 'T03', slug: 'combined-workbook', title: 'Results combined into one new workbook', group: 'Results',
    did: 'Put the result of every table into one new workbook, one sheet per table.',
    input: { name: `input.${extOf(baseName)}`, bytes: base }, outputs: [{ name: 'output.xlsx', bytes: combined.bytes }], rows: summary(combinedInput.result.rows),
    checks: [OPENS_INPUT, OPENS_OUTPUT, 'The workbook has two sheets, pq_simple__StudentNames and pq_simple__StudentResults (named after the file and the table), each with a header row and the data of its table.', 'No queries, no formulas: plain values.', SAVES]
  });
  const macroName = 'pq_vba_complex.xlsm';
  const macroBase = fixtureBytes(macroName);
  const macro = await runRecipe(macroBase, macroName, textTransform({ mode: 'newSheet' }));
  cases.push({
    id: 'T04', slug: 'new-sheet-in-macro-workbook', title: 'New sheets in a copy of a macro workbook', group: 'Results',
    did: 'Added one sheet per table to a copy of a macro-enabled workbook. The macro project is not touched.',
    input: { name: `input.${extOf(macroName)}`, bytes: macroBase }, outputs: [{ name: 'output.xlsm', bytes: changed('T04', macro) }], rows: summary(macro.result.rows),
    checks: [OPENS_INPUT, OPENS_OUTPUT, 'The workbook has its original sheet and the new Result sheets with data.', 'Alt+F11: ThisWorkbook and Sheet1 are still in the project and the code is the same as in the input.', COMPILES, 'Write down what Alt+F11 shows for the new sheets: Excel may add a module for each. Report anything unexpected.', REFRESHES, SAVES]
  });
  const signedName = 'xw_macro04.xlsm';
  const signedBase = fixtureBytes(signedName);
  const signedWb = await openWorkbook(signedBase, signedName);
  const table = runOnce({ sectionText: 'section Section1;\r\n\r\nshared Result =\r\n#table({"Name","Score"},{{"Ann",1},{"Bo",2}});', queryName: 'Result', now: PACK_NOW, previewRows: 2 }).value;
  const cs = emptyChangeSet();
  cs.sheets.add.push({ name: 'Result', table, culture: 'en-US' });
  const signedOut = await applyChangeSet(signedWb, cs, { now: zipClock(PACK_NOW) });
  cases.push({
    id: 'T05', slug: 'new-sheet-in-signed-workbook', title: 'A new sheet in a signed macro workbook', group: 'Results',
    did: 'Added a sheet called Result to a copy of a signed macro workbook. The macro project and its signature are not touched.',
    input: { name: `input.${extOf(signedName)}`, bytes: signedBase }, outputs: [{ name: 'output.xlsm', bytes: signedOut.bytes }],
    rows: [{ unit: 'Result', action: 'newSheet', verdict: 'changed', verified: true, old_hash: '', new_hash: await sha256Bytes(signedOut.bytes), signature_removed: false }],
    checks: [OPENS_INPUT, 'Alt+F11 > Tools > Digital Signature: the input shows a certificate name.', OPENS_OUTPUT, 'The workbook has the original sheets and a new sheet Result with two rows, Ann and Bo.', 'Alt+F11 > Tools > Digital Signature on the output: write down whether the certificate is still shown, shows "invalid" or shows "No certificate". Quoin expects the signature to be kept because the project is not touched.', COMPILES, SAVES]
  });
  return cases;
}

export async function buildCases() {
  return [...(await buildQueryCases()), ...(await buildMacroCases()), await buildProtectedCase(), ...(await buildSignedCases()), ...(await buildTransformCases())].sort((a, b) => a.id.localeCompare(b.id));
}

const folderOf = (c) => `cases/${c.id}-${c.slug}`;

export function checklistMarkdown(cases) {
  const out = [
    '# Quoin real-Excel check',
    '',
    'Quoin writes Excel files itself, and the only way to know Excel accepts them is to open them in Excel. This list has one block per case. For each case, open the input first, then the output, and tick every line that is true. A box that is not ticked means the check was not done or failed; nothing is checked until you tick it.',
    '',
    'Before you start:',
    '',
    '- Use a copy of the pack, not your own workbooks. Every file here is test data.',
    '- Write down the Excel version and build (File > Account > About Excel) and the system: ____________________',
    '- If Excel shows any message when opening an output (repair, recovery, "unreadable content", a security warning that the input did not show), do not click through it: copy its exact text into Notes and tick nothing else for that case.',
    '',
    'For each case write Pass, Fail or Not done on the Result line. A case passes only when every line is ticked.',
    ''
  ];
  let group = '';
  for (const c of cases) {
    if (c.group !== group) {
      group = c.group;
      out.push(`## ${group}`, '');
    }
    out.push(`### ${c.id} ${c.title}`, '');
    out.push(`What Quoin did: ${c.did}`, '');
    if (c.note) out.push(`${c.note}`, '');
    out.push(`Files: \`${folderOf(c)}/\` (${[c.input.name, ...c.outputs.map((o) => o.name), ...(c.extra || []).map((x) => x.name)].join(', ')})`, '');
    for (const check of c.checks) out.push(`- [ ] ${check}`);
    out.push('', 'Result: ____________   Notes: ______________________________________________', '');
  }
  return `${out.join('\n')}\n`;
}

function readmeText(cases) {
  return [
    '# Quoin real-Excel pack',
    '',
    `Built from Quoin with a fixed clock (${PACK_NOW}), so building it again gives the same files.`,
    '',
    `It holds ${cases.length} cases. Each folder under cases/ has the input workbook and the workbook or workbooks Quoin wrote from it. The input of every case is an Excel-made file from the Quoin test fixtures, except Q04 and Q05, whose input is the output of Q02.`,
    '',
    'How to use it:',
    '',
    '1. Open CHECKLIST.md and follow it case by case.',
    '2. Fill in the boxes, the Result line and the Notes line, and send the file back.',
    '',
    'manifest.json lists every file with its SHA-256 and what Quoin reported for it (verdict, old hash, new hash). If Excel shows a problem, send the case id and the exact message.',
    ''
  ].join('\n');
}

export async function buildExcelPack() {
  const cases = await buildCases();
  const checklist = checklistMarkdown(cases);
  const entries = [];
  const manifest = { builtWith: 'quoin', clock: PACK_NOW, cases: [] };
  const add = async (path, bytes) => {
    entries.push({ name: `quoin-excel-pack/${path}`, data: bytes });
    return { path, sha256: await sha256Bytes(bytes), bytes: bytes.length };
  };
  for (const c of cases) {
    const files = [await add(`${folderOf(c)}/${c.input.name}`, c.input.bytes)];
    for (const o of c.outputs) files.push(await add(`${folderOf(c)}/${o.name}`, o.bytes));
    for (const x of c.extra || []) files.push(await add(`${folderOf(c)}/${x.name}`, x.bytes));
    manifest.cases.push({ id: c.id, title: c.title, manual: !!c.manual, files, rows: c.rows });
  }
  await add('README.md', encode(readmeText(cases)));
  await add('CHECKLIST.md', encode(checklist));
  await add('manifest.json', encode(`${JSON.stringify(manifest, null, 2)}\n`));
  const zip = await writeZip(entries, { now: zipClock(PACK_NOW) });
  return { zip, cases, checklist, manifest, entries };
}

async function main() {
  const flag = process.argv.indexOf('--out');
  const dir = resolve(flag > 0 ? process.argv[flag + 1] : 'excel-pack');
  const pack = await buildExcelPack();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'quoin-excel-pack.zip'), pack.zip);
  writeFileSync(join(dir, 'CHECKLIST.md'), pack.checklist);
  process.stdout.write(`${pack.cases.length} cases, ${pack.entries.length} files\n${join(dir, 'quoin-excel-pack.zip')}\n${join(dir, 'CHECKLIST.md')}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
