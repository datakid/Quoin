import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createVariantTextLoader } from '../../src/app/variant-text.js';
import { SetSession } from '../../src/app/set-session.js';
import { groupVariants } from '../../src/batch/verify/variants.js';
import { indexWorkbook } from '../../src/batch/index/file-index.js';
import { executeFilePlan } from '../../src/batch/execute/collect.js';
import { appliedMessage } from '../../src/batch/protocol.js';
import { openWorkbook } from '../../src/core/workbook.js';
import { queryFile } from '../../src/core/export/files.js';

const NOW = '2026-11-14T10:00:00.000Z';
const WB = new URL('../fixtures/workbooks/', import.meta.url);
const bytes = new Uint8Array(fs.readFileSync(new URL('mixed.xlsm', WB)));

async function setWith(paths) {
  const s = new SetSession();
  s.addFiles(paths.map((p) => ({ name: p.split('/').pop(), relPath: p, size: bytes.length, lastModified: 1, file: new Blob([bytes]) })));
  for (const f of s.list()) s.indexed(f.id, await indexWorkbook(bytes, { id: f.id, name: f.name, relPath: f.relPath, size: f.size }));
  return s;
}

function pool({ fail = false } = {}) {
  const p = {
    submitted: [],
    async submit({ message }) {
      p.submitted.push(message.fileRef.id);
      if (fail) return { status: 'failed', error: 'x' };
      const meta = { id: message.fileRef.id, name: message.fileRef.name, relPath: message.fileRef.relPath, size: message.fileRef.size };
      return { status: 'done', message: appliedMessage(meta.id, await executeFilePlan(bytes, meta, message.filePlan, message.options)) };
    }
  };
  return p;
}

const item = (s, kind, name) => groupVariants(s.list().map((f) => f.index)).items.find((i) => i.kind === kind && i.name === name);
const decode = (u8) => new TextDecoder().decode(u8);

test('the text of a query version is read from the first file that holds it', async () => {
  const s = await setWith(['b/two.xlsm', 'a/one.xlsm']);
  const p = pool();
  const load = createVariantTextLoader({ pool: p, session: s, now: NOW, runId: 'r1' });
  const it = item(s, 'query', 'RawInput');
  const text = await load(it, it.versions[0]);
  const wb = await openWorkbook(bytes, 'mixed.xlsm');
  const q = wb.queries.find((x) => x.name === 'RawInput');
  assert.equal(text, decode(queryFile(q.name, q.original).data));
  assert.deepEqual(p.submitted, [s.list().find((f) => f.relPath === 'a/one.xlsm').id]);
});

test('the text of a module version is read the same way', async () => {
  const s = await setWith(['a.xlsm']);
  const load = createVariantTextLoader({ pool: pool(), session: s, now: NOW, runId: 'r1' });
  const it = item(s, 'module', 'Module1');
  const text = await load(it, it.versions[0]);
  assert.match(text, /Attribute VB_Name = "Module1"|Sub |Option Explicit/);
});

test('a version already read is not read again, and a second name from the same file reuses nothing it should not', async () => {
  const s = await setWith(['a.xlsm']);
  const p = pool();
  const load = createVariantTextLoader({ pool: p, session: s, now: NOW, runId: 'r1' });
  const it = item(s, 'query', 'RawInput');
  const a = await load(it, it.versions[0]);
  const b = await load(it, it.versions[0]);
  assert.equal(a, b);
  assert.equal(p.submitted.length, 1);
  const other = item(s, 'query', 'FinalTable');
  await load(other, other.versions[0]);
  assert.equal(p.submitted.length, 2);
});

test('a read that fails rejects and is tried again next time', async () => {
  const s = await setWith(['a.xlsm']);
  const bad = pool({ fail: true });
  const load = createVariantTextLoader({ pool: bad, session: s, now: NOW, runId: 'r1' });
  const it = item(s, 'query', 'RawInput');
  await assert.rejects(() => load(it, it.versions[0]), /variant.read/);
  await assert.rejects(() => load(it, it.versions[0]), /variant.read/);
  assert.equal(bad.submitted.length, 2);
});
