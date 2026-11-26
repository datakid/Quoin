import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openWorkbook } from '../src/core/workbook.js';
import { zipFiles } from '../src/core/export/files.js';
import { indexWorkbook } from '../src/batch/index/file-index.js';
import { parseRecipe } from '../src/batch/recipe/recipe.js';
import { resolvePlan } from '../src/batch/resolve/resolve.js';
import { executeFile } from '../src/batch/execute/index.js';
import { combineOutputs } from '../src/batch/execute/combine.js';
import { sha256Bytes } from '../src/batch/index/hash.js';
import { buildDataMashup } from '../src/core/pq/datamashup.js';
import { base64Encode } from '../src/core/bytes.js';
import { applyEdits, textContentEdit, parseXml } from '../src/core/xml.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = '2026-11-23T12:00:00.000Z';
const CLOCK = new Date(NOW);
const fixture = (dir, name) => new Uint8Array(readFileSync(join(root, 'tests', 'fixtures', dir, name)));
const external = (name) => fixture('external', name);
const generated = (name) => fixture('workbooks', name);

const CURRENT = 'Excel.CurrentWorkbook(){[Name="{unit.name}"]}[Content]';
const TWO_ROWS = 'let\n    Source = #table({"Name", "Score"}, {{"Ann", 1}, {"Bob", 2}})\nin\n    Source';
const ADDED_M = 'let\n    Source = #table({"Pack"}, {{"added by Quoin"}})\nin\n    Source';
const HELLO = 'Sub say_hello()\r\n    MsgBox "Hello from Quoin"\r\nEnd Sub\r\n';
const NEW_MODULE = 'Sub quoin_added()\r\n    MsgBox "Added by Quoin"\r\nEnd Sub\r\n';

const inject = (spec) => ({ recipe: 'inject', v: 1, inject: { match: 'name', source: 'inline', refreshOnLoad: false, ...spec } });
const replaceIn = (where, find, replacement) => ({ recipe: 'replace', v: 1, replace: { in: where, find, with: replacement, kind: 'text', matchCase: true } });
const transform = (output) => ({ recipe: 'transform', v: 1, scope: { type: 'tables', match: 'all' }, query: { source: 'inline', m: CURRENT }, output });

async function execute(name, bytes, recipeObject, id = 'f1') {
  const parsed = parseRecipe(JSON.stringify(recipeObject));
  if (!parsed.ok) throw new Error(`${name}: recipe not valid`);
  const recipe = parsed.recipe;
  const index = await indexWorkbook(bytes, { id, name, relPath: name, size: bytes.length });
  if (index.status !== 'ready') throw new Error(`${name}: not readable (${index.status})`);
  const plan = resolvePlan(recipe, [index], { now: NOW });
  if (plan.errors.length) throw new Error(`${name}: plan has errors ${JSON.stringify(plan.errors)}`);
  const wb = await openWorkbook(bytes, name);
  const result = await executeFile(wb, plan.files[0], { now: NOW, recipe, meta: index, runId: 'pack', acknowledgeSignature: true });
  const bad = result.rows.filter((r) => r.verdict !== 'changed' && r.verdict !== 'unchanged');
  if (bad.length) throw new Error(`${name}: ${bad.map((r) => `${r.verdict} ${r.reason_code}`).join(', ')}`);
  if (!result.rows.some((r) => r.verdict === 'changed')) throw new Error(`${name}: the recipe changed nothing`);
  return result;
}

const written = (result) => {
  if (!result.bytes) throw new Error('nothing was written');
  return result.bytes;
};

async function withoutBindings(bytes, name) {
  const wb = await openWorkbook(bytes, name);
  const mashup = wb.mashup;
  const model = { ...mashup.model, permissionBindings: new Uint8Array(0) };
  const encoded = base64Encode(await buildDataMashup(model, null));
  const fresh = parseXml(mashup.text.text, mashup.part);
  await wb.pkg.setText(mashup.part, applyEdits(mashup.text.text, [textContentEdit(fresh.root, encoded)]), mashup.text);
  return wb.pkg.write({ now: CLOCK });
}

const cases = [];
const add = (c) => cases.push(c);

async function build() {
  const simple = external('pq_simple.xlsx');
  const plain = external('plain_table.xlsx');
  const mixed = generated('mixed.xlsm');

  const q1 = await execute('pq_simple.xlsx', simple, inject({ target: 'query', op: 'replace', name: 'StudentResults', text: TWO_ROWS }));
  add({
    slug: 'query-replace', title: 'Replace a query', input: ['pq_simple.xlsx', simple], outputs: [['output.xlsx', written(q1)], ['output-no-bindings.xlsx', await withoutBindings(written(q1), 'output.xlsx')]],
    look: [
      'The output opens with no repair or recovery message. If it does, open output-no-bindings.xlsx as well and say which of the two opens clean: the second differs only in having no permission bindings, the fallback the spec names if Excel rejects the stored ones (MX-3). You can stop after the first if it is clean.',
      'Data > Queries & Connections lists StudentResults and StudentNames, as in the input.',
      'Right-click StudentResults > Edit. The query is now a #table of Name and Score with Ann 1 and Bob 2.',
      'Data > Refresh All finishes with no error and the StudentResults table on its sheet shows Ann 1 and Bob 2.',
      'Compare with the input: StudentNames and every other sheet look the same.'
    ]
  });

  const q2 = await execute('pq_simple.xlsx', simple, inject({ target: 'query', op: 'add', name: 'Added', text: ADDED_M }));
  const afterAdd = written(q2);
  add({
    slug: 'query-add', title: 'Add a query to a workbook that has queries', input: ['pq_simple.xlsx', simple], outputs: [['output.xlsx', afterAdd]],
    look: [
      'The output opens with no repair or recovery message.',
      'Queries & Connections now lists Added next to StudentResults and StudentNames.',
      'Right-click Added > Edit. The query is a #table with one column Pack and one row "added by Quoin".',
      'Right-click Added > Load To... > Table loads it to a new sheet with that one row.',
      'StudentResults and StudentNames are unchanged and still refresh.'
    ]
  });

  const template = external('ms_template_query.xlsx');
  const q2b = await execute('ms_template_query.xlsx', template, inject({ target: 'query', op: 'add', name: 'Added', text: ADDED_M }));
  add({
    slug: 'query-add-excel-made', title: 'Add a query to a workbook that Excel made', input: ['ms_template_query.xlsx', template], outputs: [['output.xlsx', written(q2b)]],
    look: [
      'The output opens with no repair or recovery message.',
      'Queries & Connections lists Added and the original Query1.',
      'Query1 still refreshes with no error.'
    ]
  });

  const q3 = await execute('pq_added.xlsx', afterAdd, inject({ target: 'query', op: 'remove', name: 'Added' }));
  add({
    slug: 'query-remove', title: 'Remove a query that Quoin added', input: ['pq_added.xlsx', afterAdd], outputs: [['output.xlsx', written(q3)]],
    look: [
      'The input (the output of the previous Add) opens with no repair message and shows Added.',
      'The output opens with no repair or recovery message.',
      'Queries & Connections no longer lists Added. StudentResults and StudentNames are still there and refresh.'
    ]
  });

  const q4 = await execute('pq_added.xlsx', afterAdd, inject({ target: 'query', op: 'rename', name: 'Added', newName: 'Renamed' }));
  add({
    slug: 'query-rename', title: 'Rename a query that Quoin added', input: ['pq_added.xlsx', afterAdd], outputs: [['output.xlsx', written(q4)]],
    look: [
      'The output opens with no repair or recovery message.',
      'Queries & Connections lists Renamed and no longer lists Added.',
      'Right-click Renamed > Edit. The query still returns the one-row table.'
    ]
  });

  const m1 = await execute('mixed.xlsm', mixed, inject({ target: 'module', op: 'replace', name: 'Module1', text: HELLO }));
  add({
    slug: 'module-replace', title: 'Replace a module', input: ['mixed.xlsm', mixed], outputs: [['output.xlsm', written(m1)]],
    look: [
      'The output opens with no repair or recovery message. Enable macros if asked.',
      'Alt+F11: Module1 is there and says "Hello from Quoin".',
      'Alt+F8 > say_hello > Run shows a message box with "Hello from Quoin".',
      'ThisWorkbook and Sheet1 are still there, and Debug > Compile VBAProject gives no error.'
    ]
  });

  const m2 = await execute('mixed.xlsm', mixed, inject({ target: 'module', op: 'add', name: 'QuoinAdded', text: NEW_MODULE }));
  const m2b = await execute('xw_macro01.xlsm', external('xw_macro01.xlsm'), inject({ target: 'module', op: 'add', name: 'QuoinAdded', text: NEW_MODULE }));
  add({
    slug: 'module-add', title: 'Add a module', input: ['mixed.xlsm', mixed], outputs: [['output.xlsm', written(m2)], ['output-xw_macro01.xlsm', written(m2b)]],
    look: [
      'Both outputs open with no repair or recovery message. Enable macros if asked. (The second is made from xw_macro01.xlsm, a file XlsxWriter made, not in this folder: any workbook with a macro will do for the input.)',
      'Alt+F11: QuoinAdded is listed with Module1, ThisWorkbook and Sheet1.',
      'Alt+F8 > quoin_added > Run shows a message box with "Added by Quoin".',
      'Debug > Compile VBAProject gives no error.'
    ]
  });

  const m3 = await execute('mixed.xlsm', mixed, inject({ target: 'module', op: 'remove', name: 'Module1' }));
  add({
    slug: 'module-remove', title: 'Remove a module', input: ['mixed.xlsm', mixed], outputs: [['output.xlsm', written(m3)]],
    look: [
      'The output opens with no repair or recovery message. Enable macros if asked.',
      'Alt+F11: Module1 is gone. ThisWorkbook and Sheet1 are still there.',
      'Alt+F8 lists no say_hello macro.',
      'Debug > Compile VBAProject gives no error.'
    ]
  });

  const signedGenerated = generated('signed.xlsm');
  const signedReal = external('xw_macro04.xlsm');
  const s1 = await execute('signed.xlsm', signedGenerated, inject({ target: 'module', op: 'replace', name: 'Module1', text: HELLO }));
  const s2 = await execute('xw_macro04.xlsm', signedReal, inject({ target: 'module', op: 'replace', name: 'Module1', text: HELLO }));
  add({
    slug: 'signature-removed', title: 'Change a module in a signed macro project', input: ['signed.xlsm', signedGenerated], outputs: [['output.xlsm', written(s1)], ['output-xw_macro04.xlsm', written(s2)]],
    look: [
      'Both outputs open with no repair or recovery message. Enable macros if asked.',
      'Alt+F11 > Tools > Digital Signature: the project shows "No certificate" (the signature was removed, as Quoin said it would).',
      'Module1 says "Hello from Quoin" and say_hello runs.',
      'The inputs, if you open them, show a signature.'
    ]
  });

  const r1 = await execute('mixed.xlsm', mixed, replaceIn(['vba'], 'Hello, World!', 'Hello from Quoin!'));
  const r2 = await execute('mixed.xlsm', mixed, replaceIn(['m'], 'DateTime.LocalNow', 'DateTime.FixedLocalNow'));
  add({
    slug: 'replace-in-code', title: 'Replace text in code', input: ['mixed.xlsm', mixed], outputs: [['output-vba.xlsm', written(r1)], ['output-m.xlsm', written(r2)]],
    look: [
      'Both outputs open with no repair or recovery message. Enable macros if asked.',
      'output-vba: Alt+F11 > Module1 says "Hello from Quoin!" and nothing else changed.',
      'output-m: Queries & Connections > FinalTable > Edit shows DateTime.FixedLocalNow in the Advanced Editor and the query still refreshes.'
    ]
  });

  const t1 = await execute('pq_simple.xlsx', simple, transform({ mode: 'newFile' }));
  add({
    slug: 'new-file', title: 'Transform: a new file per unit', input: ['pq_simple.xlsx', simple], outputs: t1.outputs.map((o) => [o.name, o.bytes]),
    look: [
      'Each output opens with no repair or recovery message.',
      'Each has one sheet named Result holding the values of one table of the input (the rows of StudentNames in one file, StudentResults in the other).',
      'Dates and numbers are real dates and numbers, not text. A date shows as yyyy-mm-dd hh:mm:ss: the input table\'s own display format (a long date, say) is not carried over, and that is expected.',
      'There are no queries, no macros and no formulas in the outputs.'
    ]
  });

  const t2 = await execute('pq_simple.xlsx', simple, transform({ mode: 'newSheet' }));
  add({
    slug: 'new-sheet', title: 'Transform: a new sheet in a copy', input: ['pq_simple.xlsx', simple], outputs: t2.outputs.map((o) => [o.name, o.bytes]),
    look: [
      'The output opens with no repair or recovery message.',
      'It has every sheet the input had, in the same order, followed by one new sheet per table with the transformed values.',
      'Queries & Connections still lists StudentResults and StudentNames and they still refresh.',
      'The original sheets and tables are unchanged.'
    ]
  });

  const c1 = await execute('pq_simple.xlsx', simple, transform({ mode: 'combined', name: '{file.name}__{unit.name}' }), 'f1');
  const c2 = await execute('plain_table.xlsx', plain, transform({ mode: 'combined', name: '{file.name}__{unit.name}' }), 'f2');
  const combined = await combineOutputs([c1, c2], { now: CLOCK });
  if (!combined.bytes) throw new Error('combined produced no workbook');
  add({
    slug: 'combined', title: 'Transform: one combined workbook', input: ['pq_simple.xlsx', simple], extraInputs: [['plain_table.xlsx', plain]], outputs: [[combined.name, combined.bytes]],
    look: [
      'The output opens with no repair or recovery message.',
      'One sheet per unit from both inputs, named after the file and the table, in the order of the files.',
      'Each sheet holds the values of its table. Numbers and dates are real numbers and dates. A column that was a formula in the input holds its computed value here, not the formula.'
    ]
  });
}

const pad = (n) => String(n).padStart(2, '0');

function checklist(sums) {
  const lines = [
    '# Quoin real-Excel check',
    '',
    'No agent can run Excel, so this check is yours. For each case below open the files named in "Open" in Excel, work through the list, and mark pass or fail.',
    '',
    'Report back with the case numbers that failed, what you saw (a screenshot of any repair message helps), and your Excel version and platform. A pass needs every line of the case to be true. A repair or recovery message on opening is a fail, even when the file then looks fine.',
    '',
    'Nothing here is marked verified until you say so.',
    ''
  ];
  cases.forEach((c, i) => {
    const n = pad(i + 1);
    lines.push(`## ${n} ${c.title}`, '');
    lines.push(`Input: cases/${n}-${c.slug}/input/${c.input[0]}` + (c.extraInputs ? `, ${c.extraInputs.map(([name]) => `cases/${n}-${c.slug}/input/${name}`).join(', ')}` : ''));
    lines.push(`Open: ${c.outputs.map(([name]) => `cases/${n}-${c.slug}/output/${name}`).join(', ')}`, '');
    c.look.forEach((l, k) => lines.push(`${k + 1}. ${l}`));
    lines.push('', '- [ ] pass', '- [ ] fail. What I saw: ', '');
  });
  lines.push('## File fingerprints', '', 'SHA-256 of every output, so a report can be tied to the exact file.', '', '```');
  for (const [path, sum] of sums) lines.push(`${sum}  ${path}`);
  lines.push('```', '');
  return lines.join('\n');
}

export async function makePack() {
  cases.length = 0;
  await build();
  const files = [];
  const sums = [];
  const enc = new TextEncoder();
  for (const [i, c] of cases.entries()) {
    const base = `cases/${pad(i + 1)}-${c.slug}`;
    files.push({ name: `${base}/input/${c.input[0]}`, data: c.input[1] });
    for (const [name, data] of c.extraInputs || []) files.push({ name: `${base}/input/${name}`, data });
    for (const [name, data] of c.outputs) {
      files.push({ name: `${base}/output/${name}`, data });
      sums.push([`${base}/output/${name}`, await sha256Bytes(data)]);
    }
  }
  files.unshift({ name: 'CHECKLIST.md', data: enc.encode(checklist(sums)) });
  return { bytes: await zipFiles(files, { now: CLOCK }), cases: cases.length, files: files.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2] || 'quoin-excel-pack.zip');
  const pack = await makePack();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, pack.bytes);
  process.stdout.write(`${out}: ${pack.cases} cases, ${pack.files} files, ${pack.bytes.length} bytes\n`);
}
