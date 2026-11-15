import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openWorkbook } from '../../src/core/workbook.js';
import { QuoinError } from '../../src/core/errors.js';
import { normalizeQueryText } from '../../src/core/pq/section.js';
import { indexWorkbook } from '../../src/batch/index/file-index.js';
import { refusalFor, REFUSAL_CODES } from '../../src/batch/index/refusal.js';
import { sha256Text } from '../../src/batch/index/hash.js';

const WB = new URL('../fixtures/workbooks/', import.meta.url);
const EXT = new URL('../fixtures/external/', import.meta.url);
const load = (dir, name) => new Uint8Array(fs.readFileSync(new URL(name, dir)));
const meta = (name, bytes, relPath = name) => ({ id: 'f0001', name, relPath, size: bytes.length });
const index = (dir, name, as = name) => {
  const bytes = load(dir, name);
  return indexWorkbook(bytes, meta(as, bytes));
};

const KEYS = ['id', 'name', 'relPath', 'size', 'status', 'refused', 'format', 'sheets', 'tables', 'queries', 'modules', 'pq', 'vba', 'warnings'];

test('sha256Text hashes the UTF-8 text to 64 lower case hex characters', async () => {
  assert.equal(await sha256Text(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(await sha256Text('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(await sha256Text('é'), await sha256Text('\u00e9'));
  assert.notEqual(await sha256Text('é'), await sha256Text('e'));
  assert.match(await sha256Text('x'), /^[0-9a-f]{64}$/);
});

test('refusalFor maps core errors to the nine refusal codes', () => {
  for (const code of REFUSAL_CODES) assert.equal(refusalFor(new QuoinError(code)), code);
  assert.equal(REFUSAL_CODES.length, 9);
  assert.equal(refusalFor(new QuoinError('zip.crc')), 'file.notWorkbook');
  assert.equal(refusalFor(new QuoinError('xml.parse')), 'file.notWorkbook');
  assert.equal(refusalFor(new QuoinError('limit.ratio')), 'file.tooLarge');
  assert.equal(refusalFor(new QuoinError('limit.total')), 'file.tooLarge');
  assert.equal(refusalFor(new QuoinError('zip.encrypted')), 'file.encrypted');
  assert.equal(refusalFor(new TypeError('x')), null);
  assert.equal(refusalFor(null), null);
});

test('an unsupported extension or a lock file is refused before the bytes are read', async () => {
  const bytes = load(WB, 'mixed.xlsm');
  for (const name of ['old.xls', 'data.xlsb', 'sheet.ods', 'notes.txt', 'noextension', 'book.xlsx.bak']) {
    const ix = await indexWorkbook(bytes, meta(name, bytes));
    assert.equal(ix.status, 'refused', name);
    assert.equal(ix.refused.code, 'file.unsupportedExtension', name);
  }
  for (const name of ['~$mixed.xlsm', '~$report.xlsx']) {
    const ix = await indexWorkbook(bytes, meta(name, bytes));
    assert.equal(ix.refused.code, 'file.lockFile', name);
  }
  for (const name of ['A.XLSX', 'a.Xlsm', 'a.xltx', 'a.xltm']) {
    const ix = await indexWorkbook(bytes, meta(name, bytes));
    assert.notEqual(ix.refused && ix.refused.code, 'file.unsupportedExtension', name);
  }
});

test('a refused file has the full set of keys and empty content', async () => {
  const ix = await index(WB, 'encrypted.xlsx');
  assert.deepEqual(Object.keys(ix), KEYS);
  assert.equal(ix.status, 'refused');
  assert.deepEqual(ix.refused, { code: 'file.encrypted' });
  assert.equal(ix.format, null);
  assert.deepEqual([ix.sheets, ix.tables, ix.queries, ix.modules, ix.warnings], [[], [], [], [], []]);
  assert.deepEqual(ix.pq, { editable: false, reason: null });
  assert.deepEqual(ix.vba, { present: false, signed: false, locked: false, writable: false });
});

test('content refusals are named by what the bytes are, not what the file is called', async () => {
  assert.equal((await index(EXT, 'binary.xlsb', 'renamed.xlsx')).refused.code, 'file.xlsb');
  assert.equal((await indexWorkbook(new Uint8Array([1, 2, 3, 4]), meta('junk.xlsx', [1, 2, 3, 4]))).refused.code, 'file.notWorkbook');
  assert.equal((await indexWorkbook(new Uint8Array(0), meta('empty.xlsx', []))).refused.code, 'file.notWorkbook');
  const tiny = await indexWorkbook(load(WB, 'mixed.xlsm'), meta('big.xlsm', []), { limits: { maxFileBytes: 10 } });
  assert.equal(tiny.refused.code, 'file.tooLarge');
});

test('an unexpected error that is not a Quoin error is not hidden', async () => {
  await assert.rejects(() => indexWorkbook(null, { id: 'f1', name: 'a.xlsx', relPath: 'a.xlsx', size: 0 }), TypeError);
});

test('every key of a ready index is present and in order', async () => {
  const ix = await index(WB, 'mixed.xlsm');
  assert.deepEqual(Object.keys(ix), KEYS);
  assert.deepEqual([ix.id, ix.name, ix.relPath, ix.status, ix.refused, ix.format], ['f0001', 'mixed.xlsm', 'mixed.xlsm', 'ready', null, 'xlsm']);
  assert.equal(ix.size, load(WB, 'mixed.xlsm').length);
});

test('mixed.xlsm lists its sheets, tables, queries, modules and flags', async () => {
  const ix = await index(WB, 'mixed.xlsm');
  assert.deepEqual(ix.sheets.map((s) => [s.name, s.index, s.state, s.type, s.nonEmpty]), [['Input', 0, 'visible', 'worksheet', null]]);
  assert.match(ix.sheets[0].part, /^xl\/worksheets\/sheet\d+\.xml$/);
  assert.equal(ix.tables.length, 2);
  for (const t of ix.tables) assert.deepEqual(Object.keys(t), ['name', 'sheet', 'ref', 'headerRowCount', 'tableType']);
  assert.deepEqual(ix.queries.map((q) => [q.name, q.isFunction, q.load.kind]), [['fGetNamedRange', true, 'connection'], ['RawInput', false, 'table'], ['FinalTable', false, 'table']]);
  const raw = ix.queries.find((q) => q.name === 'RawInput');
  assert.deepEqual(Object.keys(raw.load), ['kind', 'sheet', 'ref', 'tableName']);
  assert.deepEqual(ix.modules.map((m) => [m.name, m.kind]), [['Module1', 'standard'], ['ThisWorkbook', 'document'], ['Sheet1', 'document']]);
  assert.deepEqual(ix.pq, { editable: true, reason: null });
  assert.deepEqual(ix.vba, { present: true, signed: false, locked: false, writable: true });
  assert.deepEqual(ix.warnings, []);
});

test('signed.xlsm reports a signed project', async () => {
  const ix = await index(WB, 'signed.xlsm');
  assert.equal(ix.vba.signed, true);
  assert.equal(ix.vba.present, true);
  assert.equal(ix.vba.writable, true);
});

test('a workbook with no queries and no macros says so', async () => {
  const ix = await index(EXT, 'plain_table.xlsx');
  assert.deepEqual([ix.status, ix.format, ix.queries.length, ix.modules.length, ix.tables.length], ['ready', 'xlsx', 0, 0, 1]);
  assert.deepEqual(ix.pq, { editable: false, reason: 'pq.none' });
  assert.deepEqual(ix.vba, { present: false, signed: false, locked: false, writable: false });
});

test('a macro workbook with no queries lists its modules', async () => {
  const ix = await index(EXT, 'xw_macro01.xlsm');
  assert.deepEqual(ix.modules.map((m) => m.name), ['Module1', 'ThisWorkbook', 'Sheet1']);
  assert.equal(ix.queries.length, 0);
  assert.equal(ix.pq.editable, false);
});

test('query and module hashes are the SHA-256 of the same text the session compares', async () => {
  const bytes = load(WB, 'mixed.xlsm');
  const ix = await indexWorkbook(bytes, meta('mixed.xlsm', bytes));
  const wb = await openWorkbook(bytes, 'mixed.xlsm');
  for (const q of wb.queries) assert.equal(ix.queries.find((x) => x.name === q.name).hash, await sha256Text(normalizeQueryText(q.original)), q.name);
  for (const m of wb.vba.project.modules) assert.equal(ix.modules.find((x) => x.name === m.name).hash, await sha256Text(m.text), m.name);
  for (const q of ix.queries) assert.match(q.hash, /^[0-9a-f]{64}$/);
});

test('indexing is deterministic and survives structured clone', async () => {
  const bytes = load(WB, 'mixed.xlsm');
  const a = await indexWorkbook(bytes, meta('mixed.xlsm', bytes));
  const b = await indexWorkbook(bytes, meta('mixed.xlsm', bytes));
  assert.deepEqual(a, b);
  assert.deepEqual(structuredClone(a), a);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('indexing never changes the bytes it was given', async () => {
  const bytes = load(WB, 'signed.xlsm');
  const copy = bytes.slice();
  await indexWorkbook(bytes, meta('signed.xlsm', bytes));
  assert.deepEqual(bytes, copy);
});

test('every workbook fixture gets the status and counts that openWorkbook reports', async () => {
  const seen = [];
  for (const dir of [WB, EXT]) {
    for (const name of fs.readdirSync(dir).filter((n) => /\.(xlsx|xlsm)$/.test(n)).sort()) {
      const bytes = load(dir, name);
      const ix = await indexWorkbook(bytes, meta(name, bytes));
      let wb = null;
      try {
        wb = await openWorkbook(bytes, name);
      } catch (e) {
        assert.equal(ix.status, 'refused', name);
        assert.equal(ix.refused.code, refusalFor(e), name);
        seen.push(name);
        continue;
      }
      assert.equal(ix.status, 'ready', name);
      assert.equal(ix.sheets.length, wb.sheets.length, name);
      assert.equal(ix.tables.length, wb.tables.length, name);
      assert.equal(ix.queries.length, wb.queries.length, name);
      assert.equal(ix.modules.length, wb.vba && wb.vba.project ? wb.vba.project.modules.length : 0, name);
      assert.equal(ix.vba.present, !!wb.vba, name);
      seen.push(name);
    }
  }
  assert.ok(seen.length >= 14, `fixtures seen: ${seen.length}`);
});
