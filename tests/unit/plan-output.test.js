import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlanOutput, planZipName, releasedFiles, reportRows } from '../../src/app/outputs.js';
import { buildFolderOutput, hasDirectoryPicker } from '../../src/app/folder-output.js';
import { Package } from '../../src/core/opc.js';
import { readZip } from '../../src/core/zip-read.js';
import { indexWorkbook } from '../../src/batch/index/file-index.js';
import { resolvePlan } from '../../src/batch/resolve/resolve.js';
import { parseRecipe } from '../../src/batch/recipe/recipe.js';
import { runFilePlan } from '../../src/batch/execute/run-file.js';

const NOW = '2026-11-14T10:00:00.000Z';
const WB = new URL('../fixtures/workbooks/', import.meta.url);
const EXT = new URL('../fixtures/external/', import.meta.url);
const read = (dir, name) => new Uint8Array(fs.readFileSync(new URL(name, dir)));
const NEW_M = 'let\n    Source = 2\nin\n    Source';

const injectReplace = { recipe: 'inject', v: 1, inject: { target: 'query', op: 'replace', match: 'name', name: 'StudentResults', source: 'inline', text: NEW_M, refreshOnLoad: false } };
const moduleReplace = { recipe: 'inject', v: 1, inject: { target: 'module', op: 'replace', match: 'name', name: 'Module1', source: 'inline', text: 'Sub A()\r\nEnd Sub\r\n', refreshOnLoad: false } };

async function runSet(specs, json) {
  const recipe = parseRecipe(JSON.stringify(json)).recipe;
  const indexes = [];
  const sources = new Map();
  let n = 0;
  for (const [dir, name, relPath] of specs) {
    const bytes = read(dir, name);
    const meta = { id: `f${String(++n).padStart(4, '0')}`, name: relPath.split('/').pop(), relPath, size: bytes.length };
    indexes.push(await indexWorkbook(bytes, meta));
    sources.set(meta.id, { bytes, meta });
  }
  const plan = resolvePlan(recipe, indexes, { now: NOW });
  const perFile = new Map();
  for (const fp of plan.files) {
    if (!fp.units.length) continue;
    const { bytes, meta } = sources.get(fp.fileId);
    const res = await runFilePlan(bytes, meta, fp, { now: NOW, dryRun: false, limits: recipe.more.limits, culture: recipe.more.culture, runId: 'r1', recipe, acknowledgeSignature: true });
    perFile.set(fp.fileId, { rows: res.rows, changes: res.changes, warnings: res.warnings, sha256: res.sha256, bytes: res.bytes, outputs: res.outputs });
  }
  const rows = reportRows(plan, indexes, new Map([...perFile].map(([id, v]) => [id, { rows: v.rows }])), 'r1');
  return { plan, indexes, perFile, rows, sources };
}

const entries = async (zip) => {
  const pkg = new Package(readZip(zip));
  const out = new Map();
  for (const name of pkg.names()) out.set(name, await pkg.bytes(name));
  return out;
};

const csvLines = (bytes) => new TextDecoder().decode(bytes.slice(3)).split('\r\n').filter(Boolean);

test('a run zip holds report.csv first, then each changed workbook at its own relative path, and nothing else', async () => {
  const s = await runSet([[EXT, 'pq_simple.xlsx', 'east/pq_simple.xlsx'], [EXT, 'pq_simple.xlsx', 'west/pq_simple.xlsx'], [WB, 'mixed.xlsm', 'north/mixed.xlsm']], injectReplace);
  const out = await buildPlanOutput({ ...s, now: NOW, runId: 'r1' });
  assert.equal(out.ok, true);
  assert.equal(out.name, 'Inject 2026-11-14.zip');
  const all = await entries(out.bytes);
  assert.deepEqual([...all.keys()], ['report.csv', 'east/pq_simple.xlsx', 'west/pq_simple.xlsx']);
  for (const [id, path] of [['f0001', 'east/pq_simple.xlsx'], ['f0002', 'west/pq_simple.xlsx']]) assert.deepEqual(Array.from(all.get(path)), Array.from(s.perFile.get(id).bytes));
});

test('the report names each output in the output column and says yes or no, never true or false', async () => {
  const s = await runSet([[EXT, 'pq_simple.xlsx', 'east/pq_simple.xlsx'], [WB, 'mixed.xlsm', 'north/mixed.xlsm']], injectReplace);
  const out = await buildPlanOutput({ ...s, now: NOW, runId: 'r1' });
  const lines = csvLines((await entries(out.bytes)).get('report.csv'));
  const head = lines[0].split(',');
  const col = (name) => head.indexOf(name);
  const changed = lines.slice(1).map((l) => l.split(',')).find((r) => r[col('verdict')] === 'changed');
  assert.equal(changed[col('output')], 'east/pq_simple.xlsx');
  assert.equal(changed[col('verified')], 'yes');
  assert.equal(changed[col('signature_removed')], 'no');
  assert.equal(lines.some((l) => /,(true|false),/.test(l)), false);
  assert.deepEqual(out.rows.filter((r) => r.verdict === 'changed').map((r) => r.output), ['east/pq_simple.xlsx']);
});

test('a signed project is marked in the report with signature_removed yes', async () => {
  const s = await runSet([[WB, 'signed.xlsm', 'a/signed.xlsm']], moduleReplace);
  const out = await buildPlanOutput({ ...s, now: NOW, runId: 'r1' });
  const lines = csvLines((await entries(out.bytes)).get('report.csv'));
  const head = lines[0].split(',');
  assert.equal(lines[1].split(',')[head.indexOf('signature_removed')], 'yes');
});

test('a file that is held back has no entry in the zip and no output in its row', async () => {
  const s = await runSet([[EXT, 'pq_simple.xlsx', 'a.xlsx'], [EXT, 'pq_simple.xlsx', 'b.xlsx']], injectReplace);
  s.perFile.set('f0002', { ...s.perFile.get('f0002'), bytes: null, sha256: null });
  const out = await buildPlanOutput({ ...s, now: NOW, runId: 'r1' });
  assert.deepEqual([...(await entries(out.bytes)).keys()], ['report.csv', 'a.xlsx']);
  assert.equal(out.rows.find((r) => r.file === 'b.xlsx').output, '');
});

test('two files whose names differ only by case do not overwrite each other: the second gets -2 before the extension', async () => {
  const s = await runSet([[EXT, 'pq_simple.xlsx', 'x/Book.xlsx'], [EXT, 'pq_simple.xlsx', 'x/book.xlsx'], [EXT, 'pq_simple.xlsx', 'x/BOOK.xlsx']], injectReplace);
  const files = releasedFiles(s);
  assert.deepEqual(files.map((f) => f.path), ['x/Book.xlsx', 'x/book-2.xlsx', 'x/BOOK-3.xlsx']);
});

test('output paths are sanitised part by part and keep the extension', async () => {
  const s = await runSet([[EXT, 'pq_simple.xlsx', 'a:b/CON.xlsx']], injectReplace);
  assert.deepEqual(releasedFiles(s).map((f) => f.path), ['a_b/_CON.xlsx']);
});

test('the same run and time give the same zip bytes', async () => {
  const s = await runSet([[EXT, 'pq_simple.xlsx', 'east/pq_simple.xlsx']], injectReplace);
  const a = await buildPlanOutput({ ...s, now: NOW, runId: 'r1' });
  const b = await buildPlanOutput({ ...s, now: NOW, runId: 'r1' });
  assert.deepEqual(Array.from(a.bytes), Array.from(b.bytes));
});

test('a run that changed nothing still gives a zip with the report', async () => {
  const s = await runSet([[WB, 'mixed.xlsm', 'a/mixed.xlsm']], injectReplace);
  const out = await buildPlanOutput({ ...s, now: NOW, runId: 'r1' });
  assert.equal(out.ok, true);
  assert.deepEqual([...(await entries(out.bytes)).keys()], ['report.csv']);
});

test('outputs above the zip ceiling or the entry limit are refused, with the rows kept', async () => {
  const s = await runSet([[EXT, 'pq_simple.xlsx', 'a.xlsx'], [EXT, 'pq_simple.xlsx', 'b.xlsx']], injectReplace);
  const big = await buildPlanOutput({ ...s, now: NOW, runId: 'r1', ceilingBytes: 10 });
  assert.deepEqual([big.ok, big.code, big.rows.length], [false, 'output.zipTooLarge', s.rows.length]);
  const many = await buildPlanOutput({ ...s, now: NOW, runId: 'r1', maxEntries: 2 });
  assert.deepEqual([many.ok, many.code], [false, 'output.zipTooLarge']);
});

test('the zip is named for the recipe and the day', () => {
  assert.equal(planZipName('inject', NOW), 'Inject 2026-11-14.zip');
  assert.equal(planZipName('replace', NOW), 'Replace 2026-11-14.zip');
  assert.equal(planZipName('align', NOW), 'Align 2026-11-14.zip');
  assert.equal(planZipName('transform', NOW), 'Transform 2026-11-14.zip');
});

const notFound = () => Object.assign(new Error('not found'), { name: 'NotFoundError' });

class StubDir {
  constructor(name, log) {
    this.name = name;
    this.log = log;
    this.dirs = new Map();
    this.files = new Map();
  }

  async getDirectoryHandle(name, { create } = {}) {
    if (!this.dirs.has(name)) {
      if (!create) throw notFound();
      this.dirs.set(name, new StubDir(`${this.name}/${name}`, this.log));
    }
    return this.dirs.get(name);
  }

  async getFileHandle(name, { create } = {}) {
    if (!this.files.has(name)) {
      if (!create) throw notFound();
      this.files.set(name, new Uint8Array(0));
    }
    const dir = this;
    return {
      name,
      async createWritable() {
        dir.log.push(`open ${dir.name}/${name}`);
        let staged = null;
        return {
          async write(data) {
            if (dir.failOn === name) throw new Error('disk full');
            staged = new Uint8Array(data);
          },
          async close() {
            dir.files.set(name, dir.corrupt ? new Uint8Array([9]) : staged);
          },
          async abort() {
            dir.log.push(`abort ${dir.name}/${name}`);
          }
        };
      },
      async getFile() {
        const bytes = dir.files.get(name);
        return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) };
      }
    };
  }

  async removeEntry(name) {
    this.log.push(`remove ${this.name}/${name}`);
    this.files.delete(name);
  }
}

test('a folder output writes each changed workbook at its own path, then report.csv, and reads each one back', async () => {
  const s = await runSet([[EXT, 'pq_simple.xlsx', 'east/pq_simple.xlsx'], [EXT, 'pq_simple.xlsx', 'west/pq_simple.xlsx'], [WB, 'mixed.xlsm', 'north/mixed.xlsm']], injectReplace);
  const log = [];
  const root = new StubDir('out', log);
  const out = await buildFolderOutput(root, { ...s, now: NOW, runId: 'r1' }, { shouldStop: () => false });
  assert.equal(out.ok, true);
  assert.deepEqual(out.files, ['east/pq_simple.xlsx', 'west/pq_simple.xlsx']);
  assert.deepEqual(log.filter((l) => l.startsWith('open')), ['open out/east/pq_simple.xlsx', 'open out/west/pq_simple.xlsx', 'open out/report.csv']);
  assert.deepEqual(Array.from(root.dirs.get('east').files.get('pq_simple.xlsx')), Array.from(s.perFile.get('f0001').bytes));
  assert.equal(root.dirs.has('north'), false);
  const report = new TextDecoder().decode(root.files.get('report.csv').slice(3)).split('\r\n');
  assert.ok(report.some((l) => l.includes('east/pq_simple.xlsx')));
});

test('a folder output never opens an existing file for writing: the new file gets -2 and the report names it', async () => {
  const s = await runSet([[EXT, 'pq_simple.xlsx', 'east/pq_simple.xlsx']], injectReplace);
  const log = [];
  const root = new StubDir('out', log);
  const east = await root.getDirectoryHandle('east', { create: true });
  const original = new Uint8Array([1, 2, 3]);
  east.files.set('pq_simple.xlsx', original);
  root.files.set('report.csv', new Uint8Array([7]));
  const out = await buildFolderOutput(root, { ...s, now: NOW, runId: 'r1' }, { shouldStop: () => false });
  assert.equal(out.ok, true);
  assert.deepEqual(Array.from(east.files.get('pq_simple.xlsx')), [1, 2, 3]);
  assert.deepEqual(Array.from(root.files.get('report.csv')), [7]);
  assert.deepEqual(log.filter((l) => l.startsWith('open')), ['open out/east/pq_simple-2.xlsx', 'open out/report-2.csv']);
  assert.deepEqual(out.files, ['east/pq_simple-2.xlsx']);
  assert.equal(out.rows.find((r) => r.verdict === 'changed').output, 'east/pq_simple-2.xlsx');
  assert.ok(new TextDecoder().decode(root.files.get('report-2.csv')).includes('east/pq_simple-2.xlsx'));
});

test('a write that fails is aborted, stops the run, and reports what was already written', async () => {
  const s = await runSet([[EXT, 'pq_simple.xlsx', 'a/one.xlsx'], [EXT, 'pq_simple.xlsx', 'b/two.xlsx']], injectReplace);
  const log = [];
  const root = new StubDir('out', log);
  const b = await root.getDirectoryHandle('b', { create: true });
  b.failOn = 'two.xlsx';
  const out = await buildFolderOutput(root, { ...s, now: NOW, runId: 'r1' }, { shouldStop: () => false });
  assert.deepEqual([out.ok, out.code, out.files], [false, 'output.folderFailed', ['a/one.xlsx']]);
  assert.ok(log.includes('abort out/b/two.xlsx'));
  assert.equal(root.files.has('report.csv'), false);
});

test('a file that does not read back the same is removed and the run stops', async () => {
  const s = await runSet([[EXT, 'pq_simple.xlsx', 'a/one.xlsx']], injectReplace);
  const log = [];
  const root = new StubDir('out', log);
  const a = await root.getDirectoryHandle('a', { create: true });
  a.corrupt = true;
  const out = await buildFolderOutput(root, { ...s, now: NOW, runId: 'r1' }, { shouldStop: () => false });
  assert.deepEqual([out.ok, out.code, out.files], [false, 'output.folderFailed', []]);
  assert.ok(log.includes('remove out/a/one.xlsx'));
  assert.equal(a.files.has('one.xlsx'), false);
});

test('a stop request ends the folder output between files and writes no report', async () => {
  const s = await runSet([[EXT, 'pq_simple.xlsx', 'a/one.xlsx'], [EXT, 'pq_simple.xlsx', 'b/two.xlsx']], injectReplace);
  const log = [];
  let stop = false;
  const root = new StubDir('out', log);
  const out = await buildFolderOutput(root, { ...s, now: NOW, runId: 'r1' }, { shouldStop: () => { const was = stop; stop = true; return was; } });
  assert.equal(out.stopped, true);
  assert.equal(out.name, 'out');
  assert.deepEqual(log.filter((l) => l.startsWith('open')), ['open out/a/one.xlsx']);
});

test('the directory picker is only offered where the browser has one', () => {
  assert.equal(hasDirectoryPicker({}), false);
  assert.equal(hasDirectoryPicker({ showDirectoryPicker() {} }), true);
});

test('a file the rule did not match reads as skipped and a file that could not be opened reads as refused', () => {
  const indexes = [{ id: 'f1', name: 'a.xlsx', relPath: 'x/a.xlsx' }, { id: 'f2', name: 'b.xlsx', relPath: 'x/b.xlsx' }];
  const plan = { recipe: { recipe: 'inject' }, files: [{ fileId: 'f1', units: [], skipped: { code: 'skip.notApplicable' } }, { fileId: 'f2', units: [], skipped: { code: 'file.encrypted' } }] };
  const rows = reportRows(plan, indexes, new Map(), 'r1');
  assert.deepEqual(rows.map((r) => [r.file, r.verdict, r.reason_code]), [['a.xlsx', 'skipped', 'skip.notApplicable'], ['b.xlsx', 'refused', 'file.encrypted']]);
});

test('a refused row that carries a detail reads as the sentence followed by the detail in the report rows', () => {
  const indexes = [{ id: 'f1', name: 'a.xlsx', relPath: 'x/a.xlsx' }];
  const plan = { recipe: { recipe: 'inject' }, files: [{ fileId: 'f1', units: [{ name: 'a', index: 0 }], skipped: null }] };
  const results = new Map([['f1', { rows: [{ run_id: 'r1', file: 'a.xlsx', folder: 'x/', unit: 'a', unit_index: 0, recipe: 'inject', action: 'remove', compute: '', verdict: 'refused', reason_code: 'refused.loaded', reason: 'Sheet1!Table1', old_hash: '', new_hash: '', output: '', verified: false, signature_removed: false, duration_ms: 0 }] }]]);
  const rows = reportRows(plan, indexes, results, 'r1');
  assert.equal(rows[0].reason, 'This query loads to the workbook, so it cannot be removed. Nothing was changed. (Sheet1!Table1)');
});

const transformNewFile = { recipe: 'transform', v: 1, scope: { type: 'tables', match: 'all' }, query: { source: 'inline', m: 'Excel.CurrentWorkbook(){[Name="{unit.name}"]}[Content]' }, output: { mode: 'newFile' } };

test('a transform run zip holds one workbook per unit next to where its source was, and the report names each path', async () => {
  const s = await runSet([[EXT, 'pq_simple.xlsx', 'east/pq_simple.xlsx'], [EXT, 'pq_simple.xlsx', 'west/pq_simple.xlsx']], transformNewFile);
  const out = await buildPlanOutput({ ...s, now: NOW, runId: 'r1' });
  assert.equal(out.ok, true);
  assert.equal(out.name, 'Transform 2026-11-14.zip');
  const names = [...(await entries(out.bytes)).keys()];
  assert.deepEqual(names, ['report.csv', 'east/pq_simple__StudentNames.xlsx', 'east/pq_simple__StudentResults.xlsx', 'west/pq_simple__StudentNames.xlsx', 'west/pq_simple__StudentResults.xlsx']);
  assert.deepEqual(out.rows.map((r) => [r.folder, r.unit, r.verdict, r.output]), [
    ['east/', 'StudentNames', 'changed', 'east/pq_simple__StudentNames.xlsx'],
    ['east/', 'StudentResults', 'changed', 'east/pq_simple__StudentResults.xlsx'],
    ['west/', 'StudentNames', 'changed', 'west/pq_simple__StudentNames.xlsx'],
    ['west/', 'StudentResults', 'changed', 'west/pq_simple__StudentResults.xlsx']
  ]);
  const report = csvLines((await entries(out.bytes)).get('report.csv'));
  assert.equal(report.length, 5);
  assert.ok(report[1].includes('east/pq_simple__StudentNames.xlsx'));
});

test('each transform output in the zip is exactly the workbook the unit produced', async () => {
  const s = await runSet([[EXT, 'pq_simple.xlsx', 'east/pq_simple.xlsx']], transformNewFile);
  const out = await buildPlanOutput({ ...s, now: NOW, runId: 'r1' });
  const inZip = await entries(out.bytes);
  for (const o of s.perFile.get('f0001').outputs) assert.deepEqual(Array.from(inZip.get(`east/${o.name}`)), Array.from(o.bytes));
});

test('transform outputs whose names differ only by case get -2 before the extension, and each row names its own path', async () => {
  const s = await runSet([[EXT, 'pq_simple.xlsx', 'x/Book.xlsx'], [EXT, 'pq_simple.xlsx', 'x/book.xlsx']], transformNewFile);
  const files = releasedFiles(s);
  assert.deepEqual(files.map((f) => f.path), ['x/Book__StudentNames.xlsx', 'x/Book__StudentResults.xlsx', 'x/book__StudentNames-2.xlsx', 'x/book__StudentResults-2.xlsx']);
  const out = await buildPlanOutput({ ...s, now: NOW, runId: 'r1' });
  assert.deepEqual(out.rows.map((r) => r.output), files.map((f) => f.path));
});

test('a transform unit that was held back has no entry in the zip and no output in its row', async () => {
  const s = await runSet([[EXT, 'pq_simple.xlsx', 'a.xlsx']], transformNewFile);
  const held = s.perFile.get('f0001');
  s.perFile.set('f0001', { ...held, outputs: [{ ...held.outputs[0], bytes: null }, held.outputs[1]] });
  const out = await buildPlanOutput({ ...s, now: NOW, runId: 'r1' });
  assert.deepEqual([...(await entries(out.bytes)).keys()], ['report.csv', 'a__StudentResults.xlsx']);
  assert.deepEqual(out.rows.map((r) => r.output), ['', 'a__StudentResults.xlsx']);
});

test('a folder output writes every transform workbook at its own path, then report.csv', async () => {
  const s = await runSet([[EXT, 'pq_simple.xlsx', 'east/pq_simple.xlsx']], transformNewFile);
  const log = [];
  const root = new StubDir('out', log);
  const out = await buildFolderOutput(root, { ...s, now: NOW, runId: 'r1' }, { shouldStop: () => false });
  assert.equal(out.ok, true);
  assert.deepEqual(out.files, ['east/pq_simple__StudentNames.xlsx', 'east/pq_simple__StudentResults.xlsx']);
  assert.deepEqual(log.filter((l) => l.startsWith('open')), ['open out/east/pq_simple__StudentNames.xlsx', 'open out/east/pq_simple__StudentResults.xlsx', 'open out/report.csv']);
  assert.deepEqual(out.rows.map((r) => r.output), out.files);
});

