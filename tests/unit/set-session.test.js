import test from 'node:test';
import assert from 'node:assert/strict';
import { SetSession } from '../../src/app/set-session.js';

const ref = (relPath, size = 10, lastModified = 1000) => ({ name: relPath.split('/').pop(), relPath, size, lastModified, file: new Blob([new Uint8Array(1)]) });
const ready = (queries = 0) => ({ status: 'ready', queries: Array.from({ length: queries }, (_, i) => ({ name: `Q${i}` })) });

function withFiles(paths = ['a.xlsx', 'b.xlsx']) {
  const s = new SetSession();
  s.addFiles(paths.map((p) => ref(p)));
  return s;
}

function settled(paths) {
  const s = withFiles(paths);
  for (const f of s.list()) s.indexed(f.id, ready(2));
  return s;
}

test('a new session is empty with no move, no files and zero counts', () => {
  const s = new SetSession();
  assert.deepEqual([s.state, s.move, s.list(), s.progress], ['empty', null, [], null]);
  assert.deepEqual(s.counts(), { files: 0, queries: 0, ready: 0, edited: 0, skipped: 0, failed: 0, pending: 0 });
});

test('adding files starts the drop move, numbers the files and begins indexing', () => {
  const s = new SetSession();
  assert.deepEqual(s.addFiles([ref('a.xlsx'), ref('east/b.xlsx')]), { added: 2, duplicates: 0 });
  assert.deepEqual([s.state, s.move], ['indexing', 'drop']);
  assert.deepEqual(s.list().map((f) => [f.id, f.relPath, f.status, f.badge]), [['f0001', 'a.xlsx', 'pending', null], ['f0002', 'east/b.xlsx', 'pending', null]]);
  assert.equal(s.counts().pending, 2);
});

test('a file with the same path, size and time is a duplicate and changes nothing', () => {
  const s = withFiles(['a.xlsx']);
  assert.deepEqual(s.addFiles([ref('a.xlsx')]), { added: 0, duplicates: 1 });
  assert.deepEqual(s.addFiles([ref('a.xlsx', 11), ref('a.xlsx', 10, 2000)]), { added: 2, duplicates: 0 });
  assert.equal(s.list().length, 3);
  const e = new SetSession();
  const seen = [];
  e.subscribe((ev) => seen.push(ev.type));
  e.addFiles([]);
  assert.deepEqual([e.state, e.move, seen], ['empty', null, []]);
});

test('indexing results set the badge and the last one moves the session to ready and ends the move', () => {
  const s = withFiles(['a.xlsx', 'b.xlsx', 'c.xlsx']);
  assert.equal(s.indexed('f0001', ready(3)), true);
  assert.deepEqual([s.state, s.move], ['indexing', 'drop']);
  assert.equal(s.refused('f0002', 'file.encrypted'), true);
  assert.equal(s.failed('f0003', 'boom'), true);
  assert.deepEqual([s.state, s.move], ['ready', null]);
  const [a, b, c] = s.list();
  assert.deepEqual([a.badge, a.status, a.index.queries.length], ['ready', 'ready', 3]);
  assert.deepEqual([b.badge, b.status, b.skipReason], ['skipped', 'refused', 'file.encrypted']);
  assert.deepEqual([c.badge, c.status, c.error], ['failed', 'failed', 'boom']);
});

test('a result for an unknown or removed file is ignored', () => {
  const s = withFiles(['a.xlsx']);
  assert.equal(s.indexed('f0099', ready()), false);
  assert.equal(s.refused('f0099', 'file.xls'), false);
  assert.equal(s.failed('f0099', 'x'), false);
  s.removeFile('f0001');
  assert.equal(s.indexed('f0001', ready()), false);
  assert.equal(s.state, 'empty');
});

test('counts add up files, queries from usable indexes, and each badge', () => {
  const s = withFiles(['a.xlsx', 'b.xlsx', 'c.xlsx', 'd.xlsx']);
  s.indexed('f0001', ready(3));
  s.indexed('f0002', ready(2));
  s.refused('f0003', 'file.xlsb');
  s.failed('f0004', 'x');
  s.setEdited('f0002', true);
  assert.deepEqual(s.counts(), { files: 4, queries: 5, ready: 1, edited: 1, skipped: 1, failed: 1, pending: 0 });
});

test('the badge is failed before skipped before edited before ready', () => {
  const s = settled(['a.xlsx']);
  const badge = () => s.list()[0].badge;
  assert.equal(badge(), 'ready');
  s.setEdited('f0001', true);
  assert.equal(badge(), 'edited');
  s.markSkipped('f0001', 'excluded');
  assert.equal(badge(), 'skipped');
  s.markFailed('f0001', 'x');
  assert.equal(badge(), 'failed');
  s.setEdited('f0001', false);
  assert.equal(badge(), 'failed');
  assert.equal(s.list()[0].skipReason, 'excluded');
});

test('only one move is active at a time', () => {
  const s = withFiles(['a.xlsx']);
  assert.throws(() => s.beginChoose(), /drop/);
  assert.throws(() => s.beginPreview(), /drop/);
  s.indexed('f0001', ready(1));
  s.beginChoose();
  assert.deepEqual([s.state, s.move], ['ready', 'choose']);
  assert.throws(() => s.addFiles([ref('z.xlsx')]), /choose/);
  assert.throws(() => s.beginPreview(), /choose/);
  assert.throws(() => s.beginRun(1), /choose/);
  assert.throws(() => s.beginChoose(), /choose/);
  s.endChoose();
  assert.equal(s.move, null);
  s.beginRun(1);
  assert.equal(s.move, 'get');
  assert.throws(() => s.addFiles([ref('z.xlsx')]), /get/);
  assert.throws(() => s.beginChoose(), /get/);
  assert.throws(() => s.beginPreview(), /get/);
  assert.throws(() => s.removeFile('f0001'), /get/);
  assert.throws(() => s.clear(), /get/);
});

test('more files can join a drop that is still indexing', () => {
  const s = withFiles(['a.xlsx']);
  assert.deepEqual(s.addFiles([ref('b.xlsx')]), { added: 1, duplicates: 0 });
  assert.deepEqual([s.state, s.move], ['indexing', 'drop']);
});

test('preview and run need a ready set and end back in ready or done', () => {
  const s = new SetSession();
  assert.throws(() => s.beginPreview(), /empty/);
  assert.throws(() => s.beginRun(1), /empty/);
  s.addFiles([ref('a.xlsx')]);
  assert.throws(() => s.beginRun(1), /indexing/);
  s.indexed('f0001', ready(1));
  s.beginPreview();
  assert.deepEqual([s.state, s.move], ['previewing', 'get']);
  s.endPreview();
  assert.deepEqual([s.state, s.move], ['ready', null]);
  assert.throws(() => s.endPreview(), /previewing/);
  s.beginRun(1);
  assert.deepEqual([s.state, s.move], ['running', 'get']);
  assert.throws(() => s.endPreview(), /previewing/);
  s.finishRun();
  assert.deepEqual([s.state, s.move], ['done', null]);
  assert.throws(() => s.finishRun(), /running/);
});

test('a run that leaves any file failed finishes as doneWithFailures', () => {
  const s = settled(['a.xlsx', 'b.xlsx']);
  s.beginRun(2);
  s.markFailed('f0002', 'not released');
  s.finishRun();
  assert.equal(s.state, 'doneWithFailures');
  assert.equal(s.counts().failed, 1);
});

test('a file that failed to index before the run does not make the run doneWithFailures', () => {
  const s = withFiles(['a.xlsx', 'b.xlsx']);
  s.indexed('f0001', ready(1));
  s.failed('f0002', 'unreadable');
  s.beginRun(1);
  s.finishRun();
  assert.equal(s.state, 'done');
  s.beginChoose();
  s.endChoose();
  s.beginRun(1);
  s.markFailed('f0001', 'not released');
  s.finishRun();
  assert.equal(s.state, 'doneWithFailures');
});

test('choosing or adding files after a run puts the session back to ready or indexing', () => {
  const s = settled(['a.xlsx']);
  s.beginRun(1);
  s.finishRun();
  s.beginChoose();
  assert.deepEqual([s.state, s.move], ['ready', 'choose']);
  s.endChoose();
  s.beginRun(1);
  s.markFailed('f0001', 'x');
  s.finishRun();
  assert.equal(s.state, 'doneWithFailures');
  s.addFiles([ref('b.xlsx')]);
  assert.deepEqual([s.state, s.move], ['indexing', 'drop']);
  s.indexed('f0002', ready(1));
  assert.equal(s.state, 'ready');
});

test('abort ends a preview or a run and goes back to ready, and does nothing when idle', () => {
  const s = settled(['a.xlsx']);
  assert.equal(s.abort(), false);
  s.beginPreview();
  assert.equal(s.abort(), true);
  assert.deepEqual([s.state, s.move, s.progress], ['ready', null, null]);
  s.beginRun(4);
  s.setProgress(2);
  assert.equal(s.abort(), true);
  assert.deepEqual([s.state, s.move, s.progress], ['ready', null, null]);
  s.beginChoose();
  assert.equal(s.abort(), false);
  assert.equal(s.move, 'choose');
});

test('progress starts at zero for the run, is clamped, and clears when the run ends', () => {
  const s = settled(['a.xlsx', 'b.xlsx', 'c.xlsx']);
  s.beginRun(3);
  assert.deepEqual(s.progress, { done: 0, total: 3 });
  s.setProgress(2);
  assert.deepEqual(s.progress, { done: 2, total: 3 });
  s.setProgress(99);
  assert.deepEqual(s.progress, { done: 3, total: 3 });
  s.setProgress(-5);
  assert.deepEqual(s.progress, { done: 0, total: 3 });
  s.finishRun();
  assert.equal(s.progress, null);
  assert.throws(() => s.setProgress(1), /running/);
});

test('removing a file updates the set, and removing the last returns to empty', () => {
  const s = settled(['a.xlsx', 'b.xlsx']);
  s.removeFile('f0001');
  assert.deepEqual(s.list().map((f) => f.id), ['f0002']);
  assert.equal(s.state, 'ready');
  s.removeFile('f0002');
  assert.deepEqual([s.state, s.move, s.list().length], ['empty', null, 0]);
  assert.equal(s.removeFile('f0002'), false);
});

test('removing the last pending file lets indexing finish', () => {
  const s = withFiles(['a.xlsx', 'b.xlsx']);
  s.indexed('f0001', ready(1));
  s.removeFile('f0002');
  assert.deepEqual([s.state, s.move], ['ready', null]);
});

test('clear empties the set and ends a drop or a choose', () => {
  const s = settled(['a.xlsx']);
  s.beginChoose();
  s.clear();
  assert.deepEqual([s.state, s.move, s.list().length], ['empty', null, 0]);
  const t = withFiles(['a.xlsx']);
  t.clear();
  assert.deepEqual([t.state, t.move], ['empty', null]);
});

test('ids keep counting after a clear so an old reply cannot land on a new file', () => {
  const s = withFiles(['a.xlsx']);
  s.clear();
  s.addFiles([ref('a.xlsx')]);
  assert.equal(s.list()[0].id, 'f0002');
  assert.equal(s.indexed('f0001', ready()), false);
});

test('change events say what changed and unsubscribe stops them', () => {
  const s = new SetSession();
  const seen = [];
  const off = s.subscribe((e) => seen.push(e.type + (e.id ? `:${e.id}` : '') + (e.state ? `:${e.state}` : '') + (e.move !== undefined && e.type === 'move' ? `:${e.move}` : '')));
  s.addFiles([ref('a.xlsx')]);
  s.indexed('f0001', ready(1));
  assert.deepEqual(seen, ['files', 'move:drop', 'state:indexing', 'file:f0001', 'state:ready', 'move:null']);
  off();
  s.beginChoose();
  assert.equal(seen.length, 6);
});

test('the list gives copies so a caller cannot change the session', () => {
  const s = settled(['a.xlsx']);
  const copy = s.list();
  copy[0].badge = 'failed';
  copy.push({});
  assert.equal(s.list()[0].badge, 'ready');
  assert.equal(s.list().length, 1);
  assert.equal(s.file('f0001').relPath, 'a.xlsx');
  assert.equal(s.file('nope'), null);
});

test('the file Blob is kept for the run and indexes are kept as given', () => {
  const s = withFiles(['a.xlsx']);
  const ix = ready(2);
  s.indexed('f0001', ix);
  assert.equal(s.file('f0001').file instanceof Blob, true);
  assert.equal(s.index('f0001'), ix);
  assert.equal(s.index('nope'), null);
});
