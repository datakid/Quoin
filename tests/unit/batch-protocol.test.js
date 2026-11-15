import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BATCH_MESSAGE_TYPES,
  openMessage,
  openedMessage,
  refusedMessage,
  inspectMessage,
  inspectedMessage,
  applyMessage,
  appliedMessage,
  cancelMessage,
  cancelledMessage,
  progressMessage,
  isBatchMessage,
  validateMessage,
  transferListFor
} from '../../src/batch/protocol.js';

const fileRef = () => ({ id: 'f0007', name: '2024-sales.xlsx', relPath: 'east/2024-sales.xlsx', size: 3, lastModified: 1731542400000, file: new Blob([new Uint8Array(3)]) });
const index = () => ({ id: 'f0007', name: '2024-sales.xlsx', relPath: 'east/2024-sales.xlsx', size: 3, status: 'ready', refused: null, format: 'xlsx', sheets: [], tables: [], queries: [], modules: [], pq: { editable: true, reason: null }, vba: { present: false, signed: false, locked: false, writable: false }, warnings: [] });
const filePlan = () => ({ fileId: 'f0007', source: 'rule', units: [], actions: [], skipped: null });
const options = (extra = {}) => ({ now: '2026-11-14T10:00:00.000Z', dryRun: false, limits: { timeoutMs: 30000, maxRows: 1000000 }, culture: 'en-US', ...extra });
const hash = 'a'.repeat(64);
const result = (bytes) => ({ fileId: 'f0007', bytes, sha256: bytes ? hash : null, changes: [], warnings: [], rows: [] });

const everyMessage = () => [
  openMessage(fileRef()),
  openedMessage('f0007', index()),
  refusedMessage('f0007', 'file.encrypted'),
  inspectMessage(fileRef(), ['nonEmpty']),
  inspectedMessage('f0007', index()),
  applyMessage(fileRef(), filePlan(), options()),
  appliedMessage('f0007', result(new Uint8Array([1, 2, 3]))),
  appliedMessage('f0007', result(null)),
  cancelMessage('f0007'),
  cancelMessage('all'),
  cancelledMessage('f0007'),
  progressMessage('f0007', 'u1', 'run', 50)
];

test('every constructor gives a message that validates and is recognised as a batch message', () => {
  for (const m of everyMessage()) {
    assert.deepEqual(validateMessage(m), { ok: true }, m.type);
    assert.equal(isBatchMessage(m), true, m.type);
    assert.ok(BATCH_MESSAGE_TYPES.includes(m.type), m.type);
  }
});

test('the existing worker message types are not batch messages', () => {
  for (const type of ['run', 'run-steps', 'run-many', 'pin', 'release', 'binding', 'rows', 'export']) assert.equal(isBatchMessage({ type }), false, type);
  assert.equal(isBatchMessage(null), false);
  assert.equal(isBatchMessage('open'), false);
});

test('messages other than file references survive structured clone', () => {
  for (const m of everyMessage().filter((x) => x.type !== 'open' && x.type !== 'inspect' && x.type !== 'apply')) assert.deepEqual(structuredClone(m), m, m.type);
});

test('an unknown type, a missing type and a non-object are rejected', () => {
  assert.equal(validateMessage({ type: 'run' }).ok, false);
  assert.equal(validateMessage({}).ok, false);
  assert.equal(validateMessage(null).ok, false);
  assert.equal(validateMessage('open').ok, false);
});

test('a file reference needs string ids and names, numeric size and time, and a Blob', () => {
  const bad = [{ ...fileRef(), id: 7 }, { ...fileRef(), name: '' }, { ...fileRef(), relPath: null }, { ...fileRef(), size: '3' }, { ...fileRef(), lastModified: NaN }, { ...fileRef(), file: {} }];
  for (const f of bad) assert.equal(validateMessage({ type: 'open', fileRef: f }).ok, false);
  assert.equal(validateMessage({ type: 'open' }).ok, false);
});

test('inspect accepts only known needs and refuses an empty list', () => {
  assert.equal(validateMessage(inspectMessage(fileRef(), ['nonEmpty'])).ok, true);
  assert.equal(validateMessage(inspectMessage(fileRef(), [])).ok, false);
  assert.equal(validateMessage(inspectMessage(fileRef(), ['everything'])).ok, false);
});

test('apply needs a frozen ISO time, a boolean dryRun, limits and a culture', () => {
  const m = (o) => applyMessage(fileRef(), filePlan(), options(o));
  assert.equal(validateMessage(m({})).ok, true);
  assert.equal(validateMessage(m({ dryRun: true })).ok, true);
  assert.equal(validateMessage(m({ now: 'yesterday' })).ok, false);
  assert.equal(validateMessage(m({ now: undefined })).ok, false);
  assert.equal(validateMessage(m({ dryRun: 'no' })).ok, false);
  assert.equal(validateMessage(m({ limits: null })).ok, false);
  assert.equal(validateMessage(m({ culture: 5 })).ok, false);
  assert.equal(validateMessage({ type: 'apply', fileRef: fileRef(), filePlan: { fileId: 'f1' }, options: options() }).ok, false);
});

test('cancel names one file or all', () => {
  assert.equal(validateMessage({ type: 'cancel', target: '' }).ok, false);
  assert.equal(validateMessage({ type: 'cancel' }).ok, false);
  assert.equal(validateMessage({ type: 'cancel', target: 4 }).ok, false);
});

test('progress needs a known phase and a percentage from 0 to 100', () => {
  for (const phase of ['open', 'run', 'write', 'verify']) assert.equal(validateMessage(progressMessage('f1', 'u1', phase, 0)).ok, true);
  assert.equal(validateMessage(progressMessage('f1', 'u1', 'done', 0)).ok, false);
  assert.equal(validateMessage(progressMessage('f1', 'u1', 'run', 101)).ok, false);
  assert.equal(validateMessage(progressMessage('f1', 'u1', 'run', -1)).ok, false);
  assert.equal(validateMessage(progressMessage('f1', 'u1', 'run', 'half')).ok, false);
});

test('an applied message needs a 64 character lower case hash when it carries bytes', () => {
  const bytes = new Uint8Array([1]);
  assert.equal(validateMessage(appliedMessage('f1', { ...result(bytes), fileId: 'f1', sha256: 'ABC' })).ok, false);
  assert.equal(validateMessage(appliedMessage('f1', { ...result(bytes), fileId: 'f1', sha256: null })).ok, false);
  assert.equal(validateMessage(appliedMessage('f1', { ...result(null), fileId: 'f1' })).ok, true);
  assert.equal(validateMessage(appliedMessage('f1', { ...result(bytes), fileId: 'f2' })).ok, false);
});

test('an applied message whose bytes are a window onto a larger buffer is rejected', () => {
  const big = new Uint8Array(10);
  assert.equal(validateMessage(appliedMessage('f0007', result(big.subarray(2, 5)))).ok, false);
  assert.equal(validateMessage(appliedMessage('f0007', result(new Uint8Array(big.buffer)))).ok, true);
  assert.equal(validateMessage(appliedMessage('f0007', result([1, 2, 3]))).ok, false);
});

test('the transfer list of an applied message holds the output buffer and nothing else', () => {
  const bytes = new Uint8Array([9, 8, 7]);
  const m = appliedMessage('f0007', result(bytes));
  const list = transferListFor(m);
  assert.equal(list.length, 1);
  assert.equal(list[0], bytes.buffer);
  assert.deepEqual(transferListFor(appliedMessage('f0007', result(null))), []);
});

test('no other message has a transfer list', () => {
  for (const m of everyMessage().filter((x) => x.type !== 'applied')) assert.deepEqual(transferListFor(m), [], m.type);
  assert.deepEqual(transferListFor({ type: 'run' }), []);
  assert.deepEqual(transferListFor(null), []);
});

test('transferring the listed buffer detaches it and keeps the message readable', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const m = appliedMessage('f0007', result(bytes));
  const copy = structuredClone(m, { transfer: transferListFor(m) });
  assert.equal(bytes.byteLength, 0);
  assert.deepEqual([...copy.result.bytes], [1, 2, 3]);
});
