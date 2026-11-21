import test from 'node:test';
import assert from 'node:assert/strict';
import { NameBook, sheetNameBase } from '../../src/core/sheet/names.js';

test('a sheet name loses the characters Excel forbids and a leading or trailing apostrophe', () => {
  assert.equal(sheetNameBase('Q1: Sales/West [draft]?*'), 'Q1_ Sales_West _draft___');
  assert.equal(sheetNameBase("'Quoted'"), 'Quoted');
  assert.equal(sheetNameBase("It's fine"), "It's fine");
  assert.equal(sheetNameBase('a\u0001b\u001fc'), 'a_b_c');
});

test('a name with nothing left becomes Sheet', () => {
  assert.equal(sheetNameBase(''), 'Sheet');
  assert.equal(sheetNameBase("'''"), 'Sheet');
  assert.equal(sheetNameBase(undefined), 'Sheet');
});

test('a sheet name is cut to 31 code points, not 31 UTF-16 units', () => {
  assert.equal([...sheetNameBase('x'.repeat(40))].length, 31);
  const emoji = '\u{1F600}'.repeat(40);
  const cut = sheetNameBase(emoji);
  assert.equal([...cut].length, 31);
  assert.equal(cut, '\u{1F600}'.repeat(31));
});

test('a taken sheet name gets -2, -3 and so on, compared without case', () => {
  const book = new NameBook({ sheets: ['Data', 'clean'] });
  assert.equal(book.sheet('Clean'), 'Clean-2');
  assert.equal(book.sheet('CLEAN'), 'CLEAN-3');
  assert.equal(book.sheet('Data'), 'Data-2');
  assert.equal(book.sheet('Fresh'), 'Fresh');
  assert.equal(book.sheet('fresh'), 'fresh-2');
});

test('the suffix is made to fit by shortening the base, counted by code points', () => {
  const base = 'A'.repeat(31);
  const book = new NameBook({ sheets: [base] });
  const next = book.sheet(base);
  assert.equal(next, `${'A'.repeat(29)}-2`);
  assert.equal([...next].length, 31);
  const wide = new NameBook({ sheets: ['\u{1F600}'.repeat(31)] });
  assert.equal(wide.sheet('\u{1F600}'.repeat(31)), `${'\u{1F600}'.repeat(29)}-2`);
  const ten = new NameBook({ sheets: ['B'.repeat(31)] });
  for (let i = 0; i < 9; i++) ten.sheet('B'.repeat(31));
  assert.equal(ten.sheet('B'.repeat(31)), `${'B'.repeat(28)}-11`);
});

test('History is reserved, so it is treated as taken', () => {
  const book = new NameBook();
  assert.equal(book.sheet('History'), 'History-2');
  assert.equal(book.sheet('history'), 'history-3');
});

test('a name that was handed out is taken for the rest of the book', () => {
  const book = new NameBook();
  assert.deepEqual([book.sheet('Clean'), book.sheet('Clean'), book.sheet('Clean')], ['Clean', 'Clean-2', 'Clean-3']);
});

test('output file names are sanitised, and a taken name gets -2 before the extension without regard to case', () => {
  const book = new NameBook();
  assert.equal(book.file('east/2024-sales__Data', '.xlsx'), 'east_2024-sales__Data.xlsx');
  assert.equal(book.file('east/2024-sales__data', '.xlsx'), 'east_2024-sales__data-2.xlsx');
  assert.equal(book.file('east/2024-sales__DATA', '.xlsx'), 'east_2024-sales__DATA-3.xlsx');
  assert.equal(book.file('Other', '.xlsx'), 'Other.xlsx');
});

test('a name that already ends in the extension is not given it twice', () => {
  const book = new NameBook();
  assert.equal(book.file('a__Data.xlsx', '.xlsx'), 'a__Data.xlsx');
  assert.equal(book.file('a__Data.XLSX', '.xlsx'), 'a__Data-2.xlsx');
});

test('reserved device names are prefixed and long names are cut by code points with the suffix still fitting', () => {
  const book = new NameBook();
  assert.equal(book.file('CON', '.xlsx'), '_CON.xlsx');
  const long = 'n'.repeat(200);
  const first = book.file(long, '.xlsx');
  const second = book.file(long, '.xlsx');
  assert.equal([...first].length, 120);
  assert.ok([...second].length <= 120);
  assert.ok(second.endsWith('-2.xlsx'));
  assert.notEqual(first.toLowerCase(), second.toLowerCase());
  const emoji = book.file('\u{1F600}'.repeat(200), '.xlsx');
  assert.ok([...emoji].length <= 120);
});

test('files and sheets are separate namespaces', () => {
  const book = new NameBook({ sheets: ['Data'] });
  assert.equal(book.file('Data', '.xlsx'), 'Data.xlsx');
  assert.equal(book.sheet('Data'), 'Data-2');
});
