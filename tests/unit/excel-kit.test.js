import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Package } from '../../src/core/opc.js';
import { readZip } from '../../src/core/zip-read.js';
import { sha256Bytes } from '../../src/batch/index/hash.js';
import { makePack } from '../../scripts/make-excel-pack.mjs';
import { buildKit, RESULT_COLUMNS, EXCEL_ROW } from '../../scripts/make-excel-kit.mjs';
import { parseCsv } from '../../scripts/read-excel-results.mjs';

const dec = new TextDecoder();
const zipWriter = pathToFileURL(new URL('../../src/core/zip-write.js', import.meta.url).pathname).href;

const stand = `import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { writeZip } from '${zipWriter}';
const enc = new TextEncoder();
const out = resolve(process.argv[process.argv.indexOf('--out') + 1]);
const lines = ['# Real-Excel pack, part 2: Excel compute and in place', '', 'Written by Scope.', '', 'Which Excel can do what. Lines marked [needs refresh] need desktop Excel with Power Query. Lines marked [needs VBA editor] need desktop Excel on Windows or Mac. If a button is missing or a line cannot be done on your Excel, leave the box empty and write "cannot do on this Excel" instead of guessing.', ''];
const files = [];
for (const id of ['X01', 'X02', 'X03']) {
  lines.push('## ' + id + (id === 'X03' ? ' (hold: after X01 and X02)' : ''), '', 'Files: \`' + id + '/\`. SHA-256 of the output: \`00\`.', '', '- [ ] The output opens with no repair message.', '', 'Saw:', '');
  files.push({ name: id + '/input.xlsx', data: enc.encode('input ' + id) }, { name: id + '/output.xlsx', data: enc.encode('output ' + id) });
}
files.push({ name: 'CHECKLIST-SCOPE.md', data: enc.encode(lines.join('\\n')) });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'quoin-excel-pack-scope.zip'), await writeZip(files, { now: new Date(Date.UTC(2026, 10, 14)) }));
`;

const work = mkdtempSync(join(tmpdir(), 'quoin-kit-test-'));
const standIn = join(work, 'stand-in-scope-pack.mjs');
writeFileSync(standIn, stand);
test.after(() => rmSync(work, { recursive: true, force: true }));

const built = await buildKit({ packTwo: standIn });
const pkg = new Package(readZip(built.bytes));
const names = pkg.names();
const text = async (name) => dec.decode(await pkg.bytes(name));
const checklist = await text('CHECKLIST.md');

test('the kit lists every case once, in the checklist, in the folders and in the results file', async () => {
  const pack = await makePack({});
  assert.equal(built.cases.length, pack.cases + 3);
  assert.equal(new Set(built.cases.map((c) => c.id)).size, built.cases.length);
  const folders = [...new Set(names.filter((n) => n.startsWith('cases/')).map((n) => n.split('/')[1]))];
  assert.deepEqual(folders.sort(), built.cases.map((c) => c.id).sort());
  const sections = [...checklist.matchAll(/^## (\d\d|X\d\d)\b/gm)].map((m) => m[1]);
  assert.deepEqual(sections, built.cases.map((c) => (c.id.startsWith('X') ? c.id : c.id.slice(0, 2))));
  const rows = (await text('RESULTS.csv')).trim().split('\n');
  assert.equal(rows.length, built.cases.length + 2);
});

test('both packs are in the kit, the second after the first, and X03 is held after X01 and X02', async () => {
  assert.ok(names.some((n) => /^cases\/01-[^/]+\/input\//.test(n)));
  assert.ok(names.includes('cases/X01/input.xlsx') && names.includes('cases/X03/output.xlsx'));
  const part1 = checklist.indexOf('# Part 1');
  const part2 = checklist.indexOf('# Part 2');
  assert.ok(part1 >= 0 && part2 > part1);
  assert.ok(checklist.indexOf('## 01 ') > part1 && checklist.indexOf('## 01 ') < part2);
  const x = ['X01', 'X02', 'X03'].map((id) => checklist.indexOf(`## ${id}`));
  assert.ok(x[0] > part2 && x[0] < x[1] && x[1] < x[2]);
  assert.match(checklist, /## X03 \(hold: after X01 and X02\)/);
  assert.ok(!/^Files: `X\d\d\/`/m.test(checklist));
  assert.match(checklist, /Files: `cases\/X01\/`/);
});

test('the results file has the columns, the Excel row first, one empty row per case in checklist order', async () => {
  const rows = parseCsv(await text('RESULTS.csv'));
  assert.deepEqual(rows[0], RESULT_COLUMNS);
  assert.deepEqual(rows[1], [EXCEL_ROW, '', '', '', '', '']);
  assert.deepEqual(rows.slice(2).map((r) => r[0]), built.cases.map((c) => c.id));
  for (const row of rows.slice(1)) assert.deepEqual(row.slice(1), ['', '', '', '', '']);
});

test('nothing in the kit is ticked, filled in or marked verified, and each case says which row to fill in', async () => {
  assert.ok(!/\[[ xX]\]/.test(checklist));
  assert.ok(!/^(Saw:|- fail\.)/m.test(checklist));
  for (const c of built.cases) assert.equal(checklist.split(`row \`${c.id}\`.`).length - 1, 1, c.id);
  const start = await text('START-HERE.md');
  assert.match(start, /Nothing in this kit is filled in, ticked or marked as verified/);
  assert.ok(!/\bverified in Excel\b/i.test(start));
  assert.ok(!/leave its box empty/.test(start));
});

test('the kit carries Scope\'s note on which Excel can do what, pointed at the results file', () => {
  assert.match(checklist, /Which Excel can do what\. Lines marked \[needs refresh\] need desktop Excel with Power Query\./);
  assert.match(checklist, /write `cannot` in that column of `RESULTS.csv` and do not guess\./);
  assert.ok(!/leave the box empty/.test(checklist));
  assert.ok(checklist.indexOf('Which Excel can do what') < checklist.indexOf('# Part 1'));
});

test('START-HERE tells a person with only desktop Excel what to open, write down and fill in', async () => {
  const start = await text('START-HERE.md');
  for (const needle of ['CHECKLIST.md', 'RESULTS.csv', 'cases/', 'excel-edition-and-version', 'Write down your Excel first', 'repair message', 'cannot', 'not checked']) assert.ok(start.includes(needle), needle);
  for (const column of RESULT_COLUMNS.slice(1)) assert.ok(start.includes(`\`${column}\``), column);
  assert.match(start, new RegExp(`${built.cases.length} cases`));
  assert.ok(start.indexOf('The three things in this kit') < start.indexOf('Write down your Excel first'));
});

test('building the kit twice gives the same zip, byte for byte', async () => {
  const again = await buildKit({ packTwo: standIn });
  assert.equal(await sha256Bytes(again.bytes), await sha256Bytes(built.bytes));
});

test('a second pack given as a zip gives the same kit as one built by its script', async () => {
  execFileSync(process.execPath, [standIn, '--out', join(work, 'built')]);
  const fromZip = await buildKit({ packTwoZip: join(work, 'built', 'quoin-excel-pack-scope.zip') });
  assert.equal(await sha256Bytes(fromZip.bytes), await sha256Bytes(built.bytes));
});

test('the command line builds the kit from a second pack zip, and says how to when the script fails', () => {
  execFileSync(process.execPath, [standIn, '--out', join(work, 'cli')]);
  const out = join(work, 'cli-kit.zip');
  const said = execFileSync(process.execPath, ['scripts/make-excel-kit.mjs', out, '--scope-zip', join(work, 'cli', 'quoin-excel-pack-scope.zip')], { encoding: 'utf8' });
  assert.match(said, /: 25 cases, \d+ files, \d+ bytes\n$/);
  const failed = spawnSync(process.execPath, ['scripts/make-excel-kit.mjs', join(work, 'x.zip'), '--scope-zip', join(work, 'missing.zip')], { encoding: 'utf8' });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /pass its zip: node scripts\/make-excel-kit\.mjs <out\.zip> --scope-zip/);
});

test('a pack script that fails stops the kit and the message names the script and the reason', async () => {
  const failing = join(work, 'failing-pack.mjs');
  writeFileSync(failing, "throw new Error('X01: not a verified change: refused');\n");
  await assert.rejects(() => buildKit({ packTwo: failing }), (e) => /^failing-pack\.mjs failed: Error: X01: not a verified change: refused$/.test(e.message));
});

test('the kit builds with the real second pack', { todo: 'the in-place and Excel-compute code is out of the tree since b01773e, so make-excel-pack-scope.mjs cannot build on fable; the real second pack is passed with --scope-zip' }, async () => {
  const real = await buildKit();
  assert.ok(real.cases.some((c) => c.id === 'X03'));
});
