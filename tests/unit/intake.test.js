import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotDrop, splitRecipe, hasFolder, collectFiles, filesFromInput, indexPending } from '../../src/app/intake.js';
import { refusalByName } from '../../src/batch/index/file-index.js';
import { SetSession } from '../../src/app/set-session.js';
import { openedMessage, refusedMessage } from '../../src/batch/protocol.js';

const blob = (n = 1) => new Blob([new Uint8Array(n)]);
const file = (name, size = 1, lastModified = 1000) => Object.assign(new File([new Uint8Array(size)], name, { lastModified }));

const fileEntry = (fullPath, size = 1, fail = false) => ({
  isFile: true,
  isDirectory: false,
  name: fullPath.split('/').pop(),
  fullPath,
  file: (ok, err) => (fail ? err(new Error('unreadable')) : ok(file(fullPath.split('/').pop(), size)))
});

const dirEntry = (fullPath, children, batch = 100) => ({
  isFile: false,
  isDirectory: true,
  name: fullPath.split('/').pop(),
  fullPath,
  createReader() {
    let at = 0;
    return {
      readEntries: (ok) => {
        const out = children.slice(at, at + batch);
        at += out.length;
        ok(out);
      }
    };
  }
});

const item = (entry) => ({ kind: 'file', webkitGetAsEntry: () => entry });
const drop = (entries, files = []) => ({ items: entries.map(item), files });

test('refusalByName refuses lock files and unsupported extensions only', () => {
  assert.equal(refusalByName('~$a.xlsx'), 'file.lockFile');
  for (const n of ['a.xls', 'a.xlsb', 'a.csv', 'noext', 'a.xlsx.bak']) assert.equal(refusalByName(n), 'file.unsupportedExtension', n);
  for (const n of ['a.xlsx', 'A.XLSM', 'a.xltx', 'a.xltm']) assert.equal(refusalByName(n), null, n);
});

test('a drop of one file and no folder is a single file', () => {
  const snap = snapshotDrop(drop([fileEntry('/a.xlsx')], [file('a.xlsx')]));
  assert.equal(hasFolder(snap), false);
  assert.equal(snap.files.length, 1);
});

test('a dropped folder is detected even though the browser also lists it as one file', () => {
  const snap = snapshotDrop(drop([dirEntry('/books', [])], [file('books')]));
  assert.equal(hasFolder(snap), true);
});

test('a drop with no entry support still lists its files', () => {
  const snap = snapshotDrop({ items: [{ kind: 'file' }], files: [file('a.xlsx'), file('b.xlsx')] });
  assert.equal(hasFolder(snap), false);
  assert.equal(snap.files.length, 2);
  assert.equal(hasFolder(snapshotDrop({ files: [file('a.xlsx')] })), false);
});

test('a drop of files only is read from the file list, whatever the entries do', async () => {
  const hung = (name) => ({ isFile: true, isDirectory: false, name, fullPath: `/${name}`, file: () => {} });
  const snap = snapshotDrop(drop([hung('b.xlsx'), hung('a.xlsx')], [file('b.xlsx'), file('a.xlsx')]));
  assert.equal(snap.entries, null);
  const { files, unreadable } = await collectFiles(snap);
  assert.deepEqual(files.map((f) => f.relPath), ['a.xlsx', 'b.xlsx']);
  assert.deepEqual(unreadable, []);
});

test('entries are kept when a folder is among the items or the file list is empty', () => {
  assert.equal(snapshotDrop(drop([dirEntry('/books', []), fileEntry('/a.xlsx')], [file('books'), file('a.xlsx')])).entries.length, 2);
  assert.equal(snapshotDrop(drop([fileEntry('/a.xlsx')], [])).entries.length, 1);
});

test('a drop whose items are not iterable still lists its files', () => {
  const items = { length: 1, 0: { kind: 'file', webkitGetAsEntry: () => fileEntry('/a.xlsx') } };
  const snap = snapshotDrop({ items, files: [file('a.xlsx')] });
  assert.equal(snap.files.length, 1);
  assert.equal(snap.entries, null);
});

test('files dropped at the top level use their name as the relative path', async () => {
  const snap = snapshotDrop(drop([fileEntry('/b.xlsx'), fileEntry('/a.xlsx')]));
  const { files, unreadable } = await collectFiles(snap);
  assert.deepEqual(files.map((f) => f.relPath), ['a.xlsx', 'b.xlsx']);
  assert.deepEqual(unreadable, []);
  assert.deepEqual(Object.keys(files[0]).sort(), ['file', 'lastModified', 'name', 'relPath', 'size']);
});

test('a dropped folder is read recursively and relative paths keep the folder name', async () => {
  const tree = dirEntry('/books', [fileEntry('/books/a.xlsx', 5), dirEntry('/books/east', [fileEntry('/books/east/b.xlsm', 7), dirEntry('/books/east/q1', [fileEntry('/books/east/q1/c.xlsx')])])]);
  const { files } = await collectFiles(snapshotDrop(drop([tree], [file('books')])));
  assert.deepEqual(files.map((f) => f.relPath), ['books/a.xlsx', 'books/east/b.xlsm', 'books/east/q1/c.xlsx']);
  assert.deepEqual(files.map((f) => f.name), ['a.xlsx', 'b.xlsm', 'c.xlsx']);
  assert.deepEqual(files.map((f) => f.size), [5, 7, 1]);
});

test('a folder with more entries than one read returns is read to the end', async () => {
  const kids = Array.from({ length: 250 }, (_, i) => fileEntry(`/big/f${String(i).padStart(3, '0')}.xlsx`));
  const { files } = await collectFiles(snapshotDrop(drop([dirEntry('/big', kids, 100)])));
  assert.equal(files.length, 250);
  assert.equal(files[0].relPath, 'big/f000.xlsx');
  assert.equal(files[249].relPath, 'big/f249.xlsx');
});

test('a file that cannot be read is reported and the others still come through', async () => {
  const tree = dirEntry('/books', [fileEntry('/books/a.xlsx'), fileEntry('/books/bad.xlsx', 1, true), fileEntry('/books/c.xlsx')]);
  const { files, unreadable } = await collectFiles(snapshotDrop(drop([tree])));
  assert.deepEqual(files.map((f) => f.relPath), ['books/a.xlsx', 'books/c.xlsx']);
  assert.deepEqual(unreadable, ['books/bad.xlsx']);
});

test('a folder that cannot be listed is reported and does not stop the rest', async () => {
  const broken = { isFile: false, isDirectory: true, name: 'locked', fullPath: '/locked', createReader: () => ({ readEntries: (ok, err) => err(new Error('denied')) }) };
  const { files, unreadable } = await collectFiles(snapshotDrop(drop([broken, fileEntry('/a.xlsx')])));
  assert.deepEqual(files.map((f) => f.relPath), ['a.xlsx']);
  assert.deepEqual(unreadable, ['locked']);
});

test('a drop without entries uses webkitRelativePath when present and the name otherwise', async () => {
  const withPath = Object.defineProperty(file('b.xlsx'), 'webkitRelativePath', { value: 'books/east/b.xlsx' });
  const { files } = await collectFiles(snapshotDrop({ files: [withPath, file('a.xlsx')] }));
  assert.deepEqual(files.map((f) => f.relPath), ['a.xlsx', 'books/east/b.xlsx']);
});

test('files from a folder input use webkitRelativePath', () => {
  const a = Object.defineProperty(file('a.xlsx', 3, 5), 'webkitRelativePath', { value: 'books/a.xlsx' });
  const b = file('b.xlsx');
  const out = filesFromInput([a, b]);
  assert.deepEqual(out.map((f) => [f.relPath, f.name, f.size, f.lastModified]), [['b.xlsx', 'b.xlsx', 1, 1000], ['books/a.xlsx', 'a.xlsx', 3, 5]]);
  assert.equal(out[1].file, a);
});

test('collected files are ordered by relative path with plain code-unit comparison', async () => {
  const { files } = await collectFiles(snapshotDrop(drop([fileEntry('/b/z.xlsx'), fileEntry('/B/a.xlsx'), fileEntry('/a/y.xlsx')])));
  assert.deepEqual(files.map((f) => f.relPath), ['B/a.xlsx', 'a/y.xlsx', 'b/z.xlsx']);
});

function fakePool(reply) {
  const submitted = [];
  return { submitted, submit: async ({ message }) => (submitted.push(message), reply(message)) };
}

const addFiles = (session, names) => session.addFiles(names.map((n) => ({ name: n, relPath: n, size: 1, lastModified: 1, file: blob() })));

test('indexPending refuses by name without sending the file to the pool', async () => {
  const s = new SetSession();
  addFiles(s, ['notes.txt', '~$a.xlsx']);
  const pool = fakePool(() => assert.fail('should not submit'));
  await indexPending(s, pool);
  assert.deepEqual(pool.submitted, []);
  assert.deepEqual(s.list().map((f) => [f.badge, f.skipReason]), [['skipped', 'file.unsupportedExtension'], ['skipped', 'file.lockFile']]);
  assert.equal(s.state, 'ready');
});

test('indexPending sends each workbook as an open job under the session id and records the answer', async () => {
  const s = new SetSession();
  addFiles(s, ['a.xlsx', 'b.xlsx', 'c.xlsx']);
  const pool = fakePool((m) => {
    if (m.fileRef.id === 'f0001') return { status: 'done', message: openedMessage('f0001', { status: 'ready', queries: [{ name: 'Q' }] }) };
    if (m.fileRef.id === 'f0002') return { status: 'done', message: refusedMessage('f0002', 'file.encrypted') };
    return { status: 'failed', error: 'boom' };
  });
  await indexPending(s, pool);
  assert.deepEqual(pool.submitted.map((m) => [m.type, m.fileRef.id, m.fileRef.relPath]), [['open', 'f0001', 'a.xlsx'], ['open', 'f0002', 'b.xlsx'], ['open', 'f0003', 'c.xlsx']]);
  assert.deepEqual(s.list().map((f) => [f.badge, f.skipReason, f.error]), [['ready', null, null], ['skipped', 'file.encrypted', null], ['failed', null, 'boom']]);
  assert.deepEqual([s.state, s.move], ['ready', null]);
  assert.equal(s.counts().queries, 1);
});

test('indexPending leaves a cancelled job pending and indexes only files that are still pending', async () => {
  const s = new SetSession();
  addFiles(s, ['a.xlsx']);
  await indexPending(s, fakePool(() => ({ status: 'cancelled' })));
  assert.equal(s.list()[0].status, 'pending');
  const pool = fakePool((m) => ({ status: 'done', message: openedMessage(m.fileRef.id, { status: 'ready', queries: [] }) }));
  await indexPending(s, pool);
  assert.equal(pool.submitted.length, 1);
  await indexPending(s, pool);
  assert.equal(pool.submitted.length, 1);
});

test('indexPending ignores an answer for a file that was removed meanwhile', async () => {
  const s = new SetSession();
  addFiles(s, ['a.xlsx', 'b.xlsx']);
  const pool = fakePool((m) => {
    s.removeFile('f0001');
    return { status: 'done', message: openedMessage(m.fileRef.id, { status: 'ready', queries: [] }) };
  });
  await indexPending(s, pool);
  assert.deepEqual(s.list().map((f) => f.id), ['f0002']);
  assert.equal(s.state, 'ready');
});

test('splitRecipe takes a recipe file out of a drop and leaves the rest as it was', () => {
  const recipe = file('fix.quoin-recipe.json');
  const folder = file('books');
  const entries = [fileEntry('/fix.quoin-recipe.json'), dirEntry('/books', [fileEntry('/books/a.xlsx')])];
  const { recipes, rest } = splitRecipe({ entries, files: [recipe, folder] });
  assert.deepEqual(recipes.map((f) => f.name), ['fix.quoin-recipe.json']);
  assert.deepEqual(rest.files.map((f) => f.name), ['books']);
  assert.deepEqual(rest.entries.map((e) => e.name), ['books']);
  assert.equal(hasFolder(rest), true);
});

test('splitRecipe returns the same snapshot when no file is a recipe, and ignores a plain json file', () => {
  const snapshot = { entries: null, files: [file('a.xlsx'), file('notes.json'), file('x.quoin-recipe.json.txt')] };
  const out = splitRecipe(snapshot);
  assert.deepEqual(out.recipes, []);
  assert.equal(out.rest, snapshot);
});

test('splitRecipe matches the suffix in any case, finds several recipes, and works without entries', () => {
  const out = splitRecipe({ entries: null, files: [file('A.QUOIN-RECIPE.JSON'), file('b.quoin-recipe.json'), file('c.xlsx')] });
  assert.equal(out.recipes.length, 2);
  assert.deepEqual(out.rest.files.map((f) => f.name), ['c.xlsx']);
  assert.equal(out.rest.entries, null);
});

test('splitRecipe leaves nothing when only a recipe was dropped', () => {
  const out = splitRecipe({ entries: [fileEntry('/r.quoin-recipe.json')], files: [file('r.quoin-recipe.json')] });
  assert.equal(out.rest.files.length, 0);
  assert.equal(out.rest.entries.length, 0);
});
