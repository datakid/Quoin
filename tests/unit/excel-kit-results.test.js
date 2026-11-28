import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyResults, RESULT_COLUMNS, EXCEL_ROW, csvLine } from '../../scripts/make-excel-kit.mjs';
import { readResults, describe, parseCsv } from '../../scripts/read-excel-results.mjs';

const cases = [
  { id: '01-query-replace', pack: 'quoin-excel-pack' },
  { id: '02-query-add', pack: 'quoin-excel-pack' },
  { id: '03-module-add', pack: 'quoin-excel-pack' },
  { id: 'X01', pack: 'quoin-excel-pack-scope' },
  { id: 'X02', pack: 'quoin-excel-pack-scope' }
];

function filled(edits, edition = '') {
  const rows = parseCsv(emptyResults(cases));
  rows[1][5] = edition;
  for (const [id, column, value] of edits) rows.find((r) => r[0] === id)[RESULT_COLUMNS.indexOf(column)] = value;
  return `${rows.map(csvLine).join('\n')}\n`;
}

const report = (csv) => describe(readResults(csv));

test('an empty results file claims nothing', () => {
  const result = readResults(emptyResults(cases));
  assert.equal(result.valid, true);
  assert.equal(result.cases, cases.length);
  for (const column of RESULT_COLUMNS.slice(1, 5)) assert.equal(result.tally[column].yes.length, 0);
  assert.deepEqual(result.failed, []);
  const { readme, text } = describe(result);
  assert.equal(readme, 'Nothing has been checked in real Excel yet.');
  assert.match(text, /Nothing was checked: no cell is filled in/);
  assert.ok(!/opened without/.test(text));
  assert.match(text, /Excel edition and version: not given/);
});

test('a note alone is not a yes, and an empty cell is never read as one', () => {
  const result = readResults(filled([['01-query-replace', 'note', 'looked fine to me']]));
  for (const column of RESULT_COLUMNS.slice(1, 5)) assert.equal(result.tally[column].yes.length, 0);
  assert.equal(describe(result).readme, 'Nothing has been checked in real Excel yet.');
});

test('a partly filled file claims only the cases that were filled in', () => {
  const csv = filled([['01-query-replace', 'opened_without_repair', 'yes'], ['02-query-add', 'opened_without_repair', 'yes'], ['02-query-add', 'queries_ran', 'no'], ['02-query-add', 'note', 'refresh said "error"']], 'Excel 16.89 for Mac');
  const result = readResults(csv);
  assert.deepEqual(result.tally.opened_without_repair.yes, ['01-query-replace', '02-query-add']);
  assert.deepEqual(result.tally.opened_without_repair.notChecked, ['03-module-add', 'X01', 'X02']);
  assert.deepEqual(result.tally.queries_ran.no, ['02-query-add']);
  assert.deepEqual(result.tally.macros_ran.yes, []);
  const { readme, text } = describe(result);
  assert.match(readme, /^Checked in real Excel \(Excel 16\.89 for Mac\): /);
  assert.match(readme, /Of the 2 cases checked for a repair message, 2 opened without one; 3 cases were not checked for this\./);
  assert.match(readme, /Of the 1 case checked for the queries, 0 ran the queries without an error and 1 had a query error/);
  assert.match(readme, /The outputs were not reviewed\./);
  assert.ok(!/macros/.test(readme));
  assert.match(text, /3 cases have no cell filled in\./);
  assert.deepEqual(result.failed, [{ case: '02-query-add', pack: 'quoin-excel-pack', section: '02', column: 'queries_ran', step: 'the lines about refreshing queries', note: 'refresh said "error"' }]);
  assert.match(text, /- 02-query-add \(quoin-excel-pack, checklist section 02, step: the lines about refreshing queries\): refresh said "error"/);
  assert.ok(!/03-module-add|X01|X02/.test(text.slice(text.indexOf('Cases that failed'))));
});

test('a failed case in the second pack names that pack and its section', () => {
  const result = readResults(filled([['X01', 'opened_without_repair', 'no'], ['X01', 'note', 'repair message']]));
  assert.deepEqual(result.failed.map((f) => [f.case, f.pack, f.section, f.column]), [['X01', 'quoin-excel-pack-scope', 'X01', 'opened_without_repair']]);
});

test('cannot is counted by itself: not a yes, not a failure, and listed', () => {
  const result = readResults(filled([['03-module-add', 'macros_ran', 'cannot'], ['01-query-replace', 'opened_without_repair', 'yes']]));
  assert.deepEqual(result.tally.macros_ran.cannot, ['03-module-add']);
  assert.deepEqual(result.tally.macros_ran.yes, []);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.cannot, [{ case: '03-module-add', columns: ['macros_ran'] }]);
  assert.match(describe(result).text, /Steps that could not be done on this Excel:\n- 03-module-add: macros_ran/);
});

test('a value that is not yes, no or cannot is reported and not counted', () => {
  const result = readResults(filled([['01-query-replace', 'opened_without_repair', 'y'], ['02-query-add', 'opened_without_repair', 'OK']]));
  assert.deepEqual(result.tally.opened_without_repair.yes, []);
  assert.deepEqual(result.tally.opened_without_repair.invalid, ['01-query-replace', '02-query-add']);
  assert.match(describe(result).text, /case 01-query-replace, opened_without_repair: "y" is not yes, no or cannot, so it is not counted/);
  assert.equal(describe(result).readme, 'Nothing has been checked in real Excel yet.');
});

test('yes, no and cannot are read in any case and with spaces around them', () => {
  const result = readResults(filled([['01-query-replace', 'opened_without_repair', ' YES '], ['02-query-add', 'opened_without_repair', 'No'], ['03-module-add', 'opened_without_repair', 'Cannot']]));
  assert.deepEqual([result.tally.opened_without_repair.yes, result.tally.opened_without_repair.no, result.tally.opened_without_repair.cannot], [['01-query-replace'], ['02-query-add'], ['03-module-add']]);
});

test('the output column makes a claim only when a cell in it is filled', () => {
  assert.match(report(filled([['01-query-replace', 'opened_without_repair', 'yes']])).readme, /The outputs were not reviewed\./);
  const reviewed = report(filled([['01-query-replace', 'output_looked_right', 'yes'], ['02-query-add', 'output_looked_right', 'no']])).readme;
  assert.match(reviewed, /Of the 2 cases checked for the output, 1 looked right and 1 did not; 3 cases were not checked for this\./);
  assert.ok(!/outputs were not reviewed/.test(reviewed));
});

test('a file saved by Excel is read: byte order mark, semicolons, CRLF and quoted cells', () => {
  const plain = filled([['01-query-replace', 'opened_without_repair', 'yes'], ['02-query-add', 'note', 'a, b; "c"']]);
  const rows = parseCsv(plain);
  const excel = `\uFEFF${rows.map((r) => r.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';')).join('\r\n')}\r\n`;
  assert.deepEqual(parseCsv(excel), rows);
  assert.deepEqual(readResults(excel).tally, readResults(plain).tally);
  assert.equal(readResults(excel).rows.find((r) => r.id === '02-query-add').note, 'a, b; "c"');
});

test('a file that is not a results file from the kit is refused, and a repeated case is reported', () => {
  const bad = readResults('name,value\na,b\n');
  assert.equal(bad.valid, false);
  assert.match(describe(bad).text, /^Cannot read this file: the first row must be case, opened_without_repair/);
  const twice = `${filled([['01-query-replace', 'opened_without_repair', 'yes']])}01-query-replace,no,,,,\n`;
  const result = readResults(twice);
  assert.deepEqual(result.tally.opened_without_repair.yes, ['01-query-replace']);
  assert.match(describe(result).text, /case 01-query-replace appears more than once; the first row is used/);
});

test('the edition is read from the note of the Excel row, and its absence is said', () => {
  assert.match(describe(readResults(filled([['01-query-replace', 'opened_without_repair', 'yes']], 'Excel 2021 on Windows 11'))).text, /Excel edition and version: Excel 2021 on Windows 11/);
  const without = describe(readResults(filled([['01-query-replace', 'opened_without_repair', 'yes']])));
  assert.match(without.readme, /^Checked in real Excel \(edition and version not given\): /);
  assert.equal(EXCEL_ROW, 'excel-edition-and-version');
});

test('the command line prints the report, and exits 1 for a file that is not a results file and 2 without a file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'quoin-results-'));
  try {
    const good = join(dir, 'RESULTS.csv');
    writeFileSync(good, filled([['01-query-replace', 'opened_without_repair', 'yes']], 'Excel 16.89 for Mac'));
    const out = execFileSync(process.execPath, ['scripts/read-excel-results.mjs', good], { encoding: 'utf8' });
    assert.match(out, /Checked in real Excel \(Excel 16\.89 for Mac\): Of the 1 case checked for a repair message, 1 opened without one/);
    const json = JSON.parse(execFileSync(process.execPath, ['scripts/read-excel-results.mjs', good, '--json'], { encoding: 'utf8' }));
    assert.equal(json.result.cases, cases.length);
    const bad = join(dir, 'other.csv');
    writeFileSync(bad, 'a,b\n1,2\n');
    assert.equal(spawnSync(process.execPath, ['scripts/read-excel-results.mjs', bad]).status, 1);
    assert.equal(spawnSync(process.execPath, ['scripts/read-excel-results.mjs']).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
