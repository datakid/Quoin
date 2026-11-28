import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Package } from '../src/core/opc.js';
import { readZip } from '../src/core/zip-read.js';
import { writeZip } from '../src/core/zip-write.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const KIT_CLOCK = new Date(Date.UTC(2026, 10, 14, 10, 0, 0));
const enc = new TextEncoder();
const dec = new TextDecoder();

export const RESULT_COLUMNS = ['case', 'opened_without_repair', 'queries_ran', 'macros_ran', 'output_looked_right', 'note'];
export const EXCEL_ROW = 'excel-edition-and-version';

const PACK_ONE = { name: 'quoin-excel-pack', script: join(here, 'make-excel-pack.mjs') };
const PACK_TWO = { name: 'quoin-excel-pack-scope', script: join(here, 'make-excel-pack-scope.mjs') };

function section(markdown, heading) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => l === `## ${heading}`);
  if (start < 0) throw new Error(`section not found: ${heading}`);
  let end = lines.findIndex((l, i) => i > start && /^#{1,2} /.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(start, end).join('\n').trimEnd();
}

async function unzip(bytes) {
  const pkg = new Package(readZip(bytes));
  const files = new Map();
  for (const name of pkg.names()) files.set(name, await pkg.bytes(name));
  return files;
}

function casesOfPackOne(files) {
  const checklist = dec.decode(files.get('CHECKLIST.md'));
  const titles = new Map([...checklist.matchAll(/^## (\d\d) (.+)$/gm)].map((m) => [m[1], m[2]]));
  const ids = [...new Set([...files.keys()].map((n) => /^cases\/(\d\d-[^/]+)\//.exec(n)).filter(Boolean).map((m) => m[1]))];
  return ids.map((id) => ({ id, title: titles.get(id.slice(0, 2)) || id, pack: PACK_ONE.name }));
}

function casesOfPackTwo(files) {
  const checklist = dec.decode(files.get('CHECKLIST-SCOPE.md'));
  const ids = [...checklist.matchAll(/^## (X\d\d)\b(.*)$/gm)].map((m) => ({ id: m[1], title: `${m[1]}${m[2]}`.trim(), pack: PACK_TWO.name }));
  return ids;
}

function checklistBody(markdown, firstHeading) {
  const at = markdown.search(new RegExp(`^## ${firstHeading}`, 'm'));
  const fingerprints = markdown.search(/^## File fingerprints/m);
  return { body: markdown.slice(at, fingerprints >= 0 ? fingerprints : undefined).trimEnd(), fingerprints: fingerprints >= 0 ? markdown.slice(fingerprints).trimEnd() : '' };
}

function excelCapabilities(markdown) {
  const found = /^Which Excel can do what\.[^\n]*$/m.exec(markdown);
  if (!found) throw new Error('the second checklist has no paragraph on which Excel can do what');
  return found[0].replace(/If a button is missing[^\n]*$/, 'If a line cannot be done on your Excel, write `cannot` in that column of `RESULTS.csv` and do not guess.');
}

const recordLine = (id) => `Record the result in \`RESULTS.csv\`, row \`${id}\`.`;

function withRecordLines(body, idOf) {
  return body.split(/^(?=## )/m).map((section) => {
    const heading = /^## (\d\d|X\d\d)\b/.exec(section);
    if (!heading) return section;
    return `${section
      .replace(/^- \[ \] pass\n- \[ \] fail\. ?What I saw: ?\n?/m, '')
      .replace(/^Saw:[ \t]*$/m, '')
      .replace(/^- \[ \] /gm, '- ')
      .trimEnd()}\n\n${recordLine(idOf(heading[1]))}\n`;
  }).join('\n').trimEnd();
}

const csvCell = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export const csvLine = (cells) => cells.map(csvCell).join(',');

export function emptyResults(cases) {
  const rows = [RESULT_COLUMNS, [EXCEL_ROW, '', '', '', '', ''], ...cases.map((c) => [c.id, '', '', '', '', ''])];
  return `${rows.map(csvLine).join('\n')}\n`;
}

export function startHere(readme, cases) {
  const ones = cases.filter((c) => c.pack === PACK_ONE.name).length;
  const twos = cases.filter((c) => c.pack === PACK_TWO.name).length;
  return [
    '# Start here: checking Quoin\'s files in desktop Excel',
    '',
    `This kit is one zip with ${cases.length} cases: ${ones} from the first pack and ${twos} from the second (X01, X02, X03). You need desktop Excel and nothing else. You do not need Node, the repository or an agent.`,
    '',
    '## The three things in this kit',
    '',
    '1. `CHECKLIST.md`: every case in the order to open it. Work from the top to the bottom. Some cases use the output of the case before as their input, and say so. X03 is marked "hold": do it only after X01 and X02.',
    '2. `cases/`: one folder per case. Each case has an input and an output (in the first pack two folders called `input` and `output`; in the second two files with those names). Open the input first, then the output, so a bad input is not mistaken for a bad output. Do what the case says about saving; if it says nothing, close the file without saving.',
    '3. `RESULTS.csv`: one row per case, empty. You fill it in while you work, and send it back.',
    '',
    'Unzip the kit into a folder and open the files from there, not from inside the zip window.',
    '',
    section(readme, 'Write down your Excel first'),
    '',
    'Write the Windows or Mac, the edition and the version in the `note` cell of the first row of `RESULTS.csv` (the row called `excel-edition-and-version`).',
    '',
    section(readme, 'What "no repair message" looks like'),
    '',
    '## How to fill in RESULTS.csv',
    '',
    'Open `RESULTS.csv` in Excel or in any text editor. There is one row per case, and these columns:',
    '',
    '- `opened_without_repair`: did the output open with no repair message?',
    '- `queries_ran`: did the queries refresh without an error? Leave it empty for a case with no query.',
    '- `macros_ran`: did the macros run, and did the VBA editor show the code you expected? Leave it empty for a case with no macro.',
    '- `output_looked_right`: did the output match what the checklist says you should see?',
    '- `note`: one line on anything that differed. Write what you saw. A screenshot helps.',
    '',
    'In each of the first four columns write `yes`, `no` or `cannot`. Write `cannot` when your Excel cannot do that step (no Power Query, no VBA editor). An empty cell means you did not check it, and it will be read as "not checked", never as "yes". Do not fill a cell you did not look at.',
    '',
    'Save the file as CSV (comma delimited or CSV UTF-8) under the same name, `RESULTS.csv`. If Excel asks whether to keep the CSV format, keep it.',
    '',
    'Nothing in this kit is filled in, ticked or marked as verified. The cells are yours.',
    ''
  ].join('\n');
}

export function combinedChecklist(oneMarkdown, twoMarkdown, cases) {
  const idOf = (number) => (cases.find((c) => c.id === number || c.id.startsWith(`${number}-`)) || { id: number }).id;
  const one = checklistBody(oneMarkdown, '01 ');
  const two = checklistBody(twoMarkdown.replace(/^(Files: `)(X\d\d)(\/`)/gm, '$1cases/$2$3'), 'X01');
  one.body = withRecordLines(one.body, idOf);
  two.body = withRecordLines(two.body, idOf);
  return [
    '# Quoin real-Excel check: every case in one list',
    '',
    `${cases.length} cases, in the order to open them. There are no boxes to tick in this file: you record every result in \`RESULTS.csv\`, one row per case, with \`yes\`, \`no\` or \`cannot\` in each of the first four columns and a note on anything that differed. An empty cell means not checked. Nothing here is marked verified until you say so.`,
    '',
    excelCapabilities(twoMarkdown),
    '',
    '# Part 1',
    '',
    one.body,
    '',
    '# Part 2: Excel compute and in place',
    '',
    two.body,
    ...(one.fingerprints ? ['', one.fingerprints] : []),
    ''
  ].join('\n');
}

function runPack(command, args) {
  try {
    return execFileSync(process.execPath, [command, ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const lines = String(e.stderr || e.message).split('\n').map((l) => l.trim()).filter(Boolean);
    const reason = lines.find((l) => /^Error: /.test(l)) || lines[lines.length - 1] || 'no message';
    throw new Error(`${basename(command)} failed: ${reason}`);
  }
}

export async function buildKit({ packOne = PACK_ONE.script, packTwo = PACK_TWO.script, packTwoZip = null, readme = readFileSync(join(here, '..', 'docs', 'fable', 'excel-pack', 'README.md'), 'utf8') } = {}) {
  const work = mkdtempSync(join(tmpdir(), 'quoin-kit-'));
  try {
    const oneZip = join(work, 'pack-one.zip');
    runPack(packOne, [oneZip]);
    if (!packTwoZip) runPack(packTwo, ['--out', join(work, 'two')]);
    const one = await unzip(new Uint8Array(readFileSync(oneZip)));
    const two = await unzip(new Uint8Array(readFileSync(packTwoZip || join(work, 'two', 'quoin-excel-pack-scope.zip'))));
    const cases = [...casesOfPackOne(one), ...casesOfPackTwo(two)];
    const files = [];
    for (const [name, data] of one) if (name.startsWith('cases/')) files.push({ name, data });
    for (const [name, data] of two) if (/^X\d\d\//.test(name)) files.push({ name: `cases/${name}`, data });
    const checklist = combinedChecklist(dec.decode(one.get('CHECKLIST.md')), dec.decode(two.get('CHECKLIST-SCOPE.md')), cases);
    const entries = [
      { name: 'START-HERE.md', data: enc.encode(startHere(readme, cases)) },
      { name: 'CHECKLIST.md', data: enc.encode(checklist) },
      { name: 'RESULTS.csv', data: enc.encode(emptyResults(cases)) },
      ...files
    ];
    return { bytes: await writeZip(entries, { now: KIT_CLOCK }), cases, files: entries.length };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = args.indexOf('--scope-zip');
  const packTwoZip = flag >= 0 ? resolve(args[flag + 1]) : null;
  const out = resolve(args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--scope-zip') || 'quoin-excel-kit.zip');
  try {
    const kit = await buildKit({ packTwoZip });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, kit.bytes);
    process.stdout.write(`${out}: ${kit.cases.length} cases, ${kit.files} files, ${kit.bytes.length} bytes\n`);
  } catch (e) {
    process.stderr.write(`${e.message}\nIf the second pack was built somewhere else, pass its zip: node scripts/make-excel-kit.mjs <out.zip> --scope-zip <quoin-excel-pack-scope.zip>\n`);
    process.exit(1);
  }
}
