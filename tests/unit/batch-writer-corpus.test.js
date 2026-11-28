import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openWorkbook } from '../../src/core/workbook.js';
import { applyChangeSet, emptyChangeSet } from '../../src/core/save.js';
import { checkSection } from '../../src/core/m/engine.js';
import { readVbaProject } from '../../src/core/vba/vba-project.js';
import { writeVbaProject, moduleNameMap, moduleRemovalProblem, moduleNameProblem } from '../../src/core/vba/writeback.js';
import { equalBytes } from '../../src/core/bytes.js';

const NOW = new Date(2026, 10, 14, 10, 0, 0);
const NEW_M = 'let\n    Source = 1\nin\n    Source';
const CODE = 'Sub Added()\n    MsgBox "added"\nEnd Sub\n';
const dirs = ['external', 'workbooks'].map((d) => [d, fileURLToPath(new URL(`../fixtures/${d}/`, import.meta.url))]);
const files = dirs.flatMap(([, dir]) => readdirSync(dir).map((name) => ({ name, path: `${dir}${name}` })));
const read = (f) => new Uint8Array(readFileSync(f.path));
const open = async (f) => {
  try {
    return await openWorkbook(read(f), f.name);
  } catch {
    return null;
  }
};
const streamOf = (project, name) => project.cfb.root.children.find((c) => c.name === name);
const names = (project) => project.modules.map((m) => m.name);

const workbooks = files.filter((f) => /\.(xlsx|xlsm)$/i.test(f.name));
const bins = files.filter((f) => /^xw_vbaProject\d+\.bin$/i.test(f.name));
const opened = await Promise.all(workbooks.map(async (f) => ({ f, wb: await open(f) })));
const queryFiles = opened.filter(({ wb }) => wb && wb.mashup && !wb.mashup.error && !wb.warnings.length).map(({ f }) => f);
const macroFiles = opened.filter(({ wb }) => wb && wb.vba && wb.vba.project && wb.vba.project.writable).map(({ f }) => f);
const binFiles = bins.filter((f) => readVbaProject(read(f)).writable);

test('corpus: the fixtures are found', () => {
  assert.ok(queryFiles.length >= 8);
  assert.ok(macroFiles.length >= 6);
  assert.ok(binFiles.length >= 4);
});

for (const f of queryFiles) {
  test(`corpus: ${f.name}: queries can be added, replaced and removed and the output opens clean`, async () => {
    const wb = await open(f);
    const add = emptyChangeSet();
    add.queries.add.set('Corpus Added', NEW_M);
    add.queries.add.set('corpus2', `${NEW_M}\n// end`);
    const res = await applyChangeSet(wb, add, { now: NOW, checkSection });
    const back = await openWorkbook(res.bytes, f.name);
    assert.deepEqual(back.warnings, []);
    assert.deepEqual(back.queries.map((q) => q.name), [...wb.queries.map((q) => q.name), 'Corpus Added', 'corpus2']);
    for (const q of wb.queries) assert.equal(back.queries.find((x) => x.name === q.name).original, q.original);
    const gone = emptyChangeSet();
    gone.queries.remove.add('Corpus Added');
    gone.queries.remove.add('corpus2');
    const again = await openWorkbook((await applyChangeSet(back, gone, { now: NOW, checkSection })).bytes, f.name);
    assert.equal(again.mashup.section.text, wb.mashup.section.text);
    assert.equal(again.mashup.model.metadata.xml, wb.mashup.model.metadata.xml);
    const first = wb.queries[0];
    if (first) {
      const edit = emptyChangeSet();
      edit.queries.replace.set(first.name, `${first.original}\n// corpus`);
      const edited = await openWorkbook((await applyChangeSet(wb, edit, { now: NOW, checkSection })).bytes, f.name);
      assert.ok(edited.queries[0].original.endsWith('// corpus'));
      assert.deepEqual(edited.warnings, []);
    }
  });

  test(`corpus: ${f.name}: queries without a connection can be renamed and then removed, loaded ones are refused`, async () => {
    const wb = await open(f);
    const add = emptyChangeSet();
    add.queries.add.set('Corpus Added', NEW_M);
    const withAdded = await openWorkbook((await applyChangeSet(wb, add, { now: NOW, checkSection })).bytes, f.name);
    const rename = emptyChangeSet();
    rename.queries.rename.set('Corpus Added', 'Corpus Renamed');
    const renamed = await openWorkbook((await applyChangeSet(withAdded, rename, { now: NOW, checkSection })).bytes, f.name);
    assert.ok(renamed.queries.some((q) => q.name === 'Corpus Renamed'));
    assert.deepEqual(renamed.warnings, []);
    for (const q of wb.queries.filter((x) => x.connection || x.load.kind !== 'connection')) {
      const cs = emptyChangeSet();
      cs.queries.remove.add(q.name);
      await assert.rejects(() => applyChangeSet(wb, cs, { now: NOW }), (e) => e instanceof TypeError && /^refused\.(loaded|usedBy): /.test(e.message), q.name);
    }
  });
}

async function checkModuleCycle(project, label) {
  const free = ['Corpus1', 'Corpus2', 'CorpusX'].filter((n) => !moduleNameProblem(project, n));
  assert.ok(free.length >= 2, label);
  const added = readVbaProject(writeVbaProject(project, new Map(), { add: new Map(free.map((n) => [n, CODE])) }));
  assert.deepEqual(added.anomalies, [], label);
  assert.equal(added.writable, true, label);
  assert.deepEqual(names(added), [...names(project), ...free], label);
  for (const m of project.modules) assert.equal(added.modules.find((x) => x.name === m.name).text, m.text, `${label} ${m.name}`);
  for (const n of free) assert.equal(added.modules.find((x) => x.name === n).model.visible, CODE, `${label} ${n}`);
  assert.ok(equalBytes(streamOf(added, 'PROJECTwm').data, moduleNameMap(names(added), added.codePage)), label);
  const gone = readVbaProject(writeVbaProject(added, new Map(), { remove: new Set(free) }));
  assert.deepEqual(names(gone), names(project), label);
  assert.equal(Buffer.from(streamOf(gone, 'PROJECT').data).toString('latin1'), Buffer.from(streamOf(project, 'PROJECT').data).toString('latin1'), label);
  assert.ok(equalBytes(streamOf(gone, 'PROJECTwm').data, streamOf(project, 'PROJECTwm').data), label);
  assert.deepEqual(gone.records.map((r) => r.id), project.records.map((r) => r.id), label);
  for (const m of project.modules) assert.equal(gone.modules.find((x) => x.name === m.name).text, m.text, label);
  const removable = project.modules.filter((m) => !moduleRemovalProblem(project, m.name));
  for (const m of removable) {
    const without = readVbaProject(writeVbaProject(project, new Map(), { remove: new Set([m.name]) }));
    assert.deepEqual(without.anomalies, [], `${label} without ${m.name}`);
    assert.deepEqual(names(without), names(project).filter((n) => n !== m.name), `${label} without ${m.name}`);
    assert.ok(equalBytes(streamOf(without, 'PROJECTwm').data, moduleNameMap(names(without), without.codePage)), `${label} without ${m.name}`);
    assert.ok(!Buffer.from(streamOf(without, 'PROJECT').data).toString('latin1').includes(`Module=${m.name}`), `${label} without ${m.name}`);
  }
  return removable.length;
}

for (const f of macroFiles) {
  test(`corpus: ${f.name}: modules can be added, removed and changed and the project stays readable`, async () => {
    const wb = await open(f);
    await checkModuleCycle(wb.vba.project, f.name);
    const cs = emptyChangeSet();
    cs.modules.add.set('Corpus1', CODE);
    cs.acknowledgeSignature = true;
    const res = await applyChangeSet(wb, cs, { now: NOW });
    assert.deepEqual((await openWorkbook(res.bytes, f.name)).warnings, wb.warnings);
  });
}

for (const f of binFiles) {
  test(`corpus: ${f.name}: an Excel-made vbaProject.bin takes a module and gives it back`, async () => {
    const project = readVbaProject(read(f));
    await checkModuleCycle(project, f.name);
  });
}

const entryNames = (wb) => wb.pkg.zip.entries.map((e) => e.name);
const partBytes = async (wb) => {
  const parts = new Map();
  for (const name of entryNames(wb)) parts.set(name, Buffer.from(await wb.pkg.bytes(name)));
  return parts;
};

async function reopenAndCompare(before, outBytes, name, expected, label) {
  const back = await openWorkbook(outBytes, name);
  const a = await partBytes(before);
  const b = await partBytes(back);
  const got = { changed: [], removed: [], added: [] };
  for (const [part, bytes] of a) {
    if (!b.has(part)) got.removed.push(part);
    else if (!bytes.equals(b.get(part))) got.changed.push(part);
  }
  for (const part of b.keys()) if (!a.has(part)) got.added.push(part);
  const sorted = (o) => ({ changed: [...(o.changed || [])].sort(), removed: [...(o.removed || [])].sort(), added: [...(o.added || [])].sort() });
  assert.deepEqual(sorted(got), sorted(expected), label);
  assert.deepEqual(back.warnings, before.warnings, label);
  return back;
}

const vbaPartOf = (wb) => entryNames(wb).find((n) => /vbaProject\.bin$/.test(n));
const signatureParts = (wb) => entryNames(wb).filter((n) => /vbaProjectSignature\.bin$/.test(n));

function moduleParts(wb) {
  const vba = vbaPartOf(wb);
  const signatures = signatureParts(wb);
  if (!signatures.length) return { changed: [vba] };
  return { changed: [vba, '[Content_Types].xml'], removed: [...signatures, `${vba.replace(/[^/]+$/, '_rels/')}${vba.split('/').pop()}.rels`] };
}

const queryParts = (wb, query, refresh = true) => ({ changed: [wb.mashup.part, ...(refresh && query && query.connection && !query.connection.refreshOnLoad ? [wb.connections.part] : [])] });

async function runChange(wb, change, options = {}) {
  const cs = emptyChangeSet();
  change(cs);
  cs.acknowledgeSignature = true;
  return (await applyChangeSet(wb, cs, { now: NOW, checkSection, ...options })).bytes;
}

for (const f of queryFiles) {
  test(`corpus: ${f.name}: a query change touches only the query data and, for a replace, the connection`, async () => {
    const wb = await open(f);
    const added = await reopenAndCompare(wb, await runChange(wb, (cs) => cs.queries.add.set('Corpus Added', NEW_M)), f.name, queryParts(wb, null), `${f.name} add`);
    assert.ok(added.queries.some((q) => q.name === 'Corpus Added'));
    for (const q of wb.queries) {
      const text = `${q.original}\n// corpus ${q.name}`;
      const replaced = await reopenAndCompare(wb, await runChange(wb, (cs) => cs.queries.replace.set(q.name, text)), f.name, queryParts(wb, q), `${f.name} replace ${q.name}`);
      assert.equal(replaced.queries.find((x) => x.name === q.name).original, text, q.name);
      for (const other of wb.queries.filter((x) => x.name !== q.name)) assert.equal(replaced.queries.find((x) => x.name === other.name).original, other.original, `${q.name} / ${other.name}`);
      await reopenAndCompare(wb, await runChange(wb, (cs) => cs.queries.replace.set(q.name, text), { refreshOnLoad: false }), f.name, queryParts(wb, q, false), `${f.name} replace ${q.name} without refresh`);
    }
    const removed = await openWorkbook(await runChange(added, (cs) => cs.queries.remove.add('Corpus Added')), f.name);
    assert.deepEqual(removed.queries.map((q) => q.name), wb.queries.map((q) => q.name));
    assert.equal(removed.mashup.section.text, wb.mashup.section.text);
    const renamed = await runChange(added, (cs) => cs.queries.rename.set('Corpus Added', 'Corpus Renamed'));
    await reopenAndCompare(added, renamed, f.name, { changed: [wb.mashup.part] }, `${f.name} rename`);
  });
}

for (const f of macroFiles) {
  test(`corpus: ${f.name}: a module change touches only the project part, and a signature goes with it`, async () => {
    const wb = await open(f);
    const project = wb.vba.project;
    const expected = moduleParts(wb);
    const withNames = async (bytes, label) => (await reopenAndCompare(wb, bytes, f.name, expected, label)).vba.project;
    const added = await withNames(await runChange(wb, (cs) => cs.modules.add.set('Corpus1', CODE)), `${f.name} add`);
    assert.deepEqual(names(added), [...names(project), 'Corpus1']);
    assert.equal(added.modules.find((m) => m.name === 'Corpus1').model.visible, CODE);
    for (const m of project.modules.filter((x) => x.model)) {
      const text = `${m.model.visible}\n' corpus ${m.name}`;
      const replaced = await withNames(await runChange(wb, (cs) => cs.modules.replace.set(m.name, text)), `${f.name} replace ${m.name}`);
      assert.deepEqual(names(replaced), names(project), m.name);
      assert.equal(replaced.modules.find((x) => x.name === m.name).model.visible, text, m.name);
      for (const other of project.modules.filter((x) => x.name !== m.name)) assert.equal(replaced.modules.find((x) => x.name === other.name).text, other.text, `${m.name} / ${other.name}`);
    }
    for (const m of project.modules.filter((x) => !moduleRemovalProblem(project, x.name))) {
      const gone = await withNames(await runChange(wb, (cs) => cs.modules.remove.add(m.name)), `${f.name} remove ${m.name}`);
      assert.deepEqual(names(gone), names(project).filter((n) => n !== m.name), m.name);
      for (const other of gone.modules) assert.equal(other.text, project.modules.find((x) => x.name === other.name).text, `${m.name} / ${other.name}`);
    }
    const back = await openWorkbook(await runChange(wb, (cs) => cs.modules.add.set('Corpus1', CODE)), f.name);
    assert.equal(signatureParts(back).length, 0);
    assert.ok(!(await back.pkg.text('[Content_Types].xml')).text.includes('vbaProjectSignature'));
  });
}

for (const f of macroFiles.filter((x) => /xw_macro04|signed/.test(x.name))) {
  test(`corpus: ${f.name}: a signed project is not changed unless the loss of the signature is confirmed`, async () => {
    const wb = await open(f);
    assert.ok(signatureParts(wb).length > 0);
    const module = wb.vba.project.modules.find((m) => m.model);
    const removable = wb.vba.project.modules.find((m) => !moduleRemovalProblem(wb.vba.project, m.name));
    const changes = [(cs) => cs.modules.add.set('Corpus1', CODE), (cs) => cs.modules.replace.set(module.name, `${module.model.visible}\n' corpus`)];
    if (removable) changes.push((cs) => cs.modules.remove.add(removable.name));
    for (const change of changes) {
      const cs = emptyChangeSet();
      change(cs);
      await assert.rejects(() => applyChangeSet(wb, cs, { now: NOW, checkSection }), (e) => e.code === 'vba.signature' && /not confirmed/.test(e.message));
    }
  });
}

for (const f of macroFiles.filter((x) => queryFiles.some((q) => q.name === x.name))) {
  test(`corpus: ${f.name}: a query change and a module change in one run touch only the query data, the connection-free project part and what the signature needs`, async () => {
    const wb = await open(f);
    const bytes = await runChange(wb, (cs) => {
      cs.queries.add.set('Corpus Added', NEW_M);
      cs.modules.add.set('Corpus1', CODE);
    });
    const parts = moduleParts(wb);
    const back = await reopenAndCompare(wb, bytes, f.name, { ...parts, changed: [...parts.changed, wb.mashup.part] }, f.name);
    assert.ok(back.queries.some((q) => q.name === 'Corpus Added'));
    assert.ok(back.vba.project.modules.some((m) => m.name === 'Corpus1'));
  });
}
