import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openWorkbook } from '../../src/core/workbook.js';
import { readVbaProject } from '../../src/core/vba/vba-project.js';
import { parseDir, REC } from '../../src/core/vba/dir-stream.js';
import { decompress } from '../../src/core/vba/ovba-decompress.js';
import { writeVbaProject, moduleNameProblem, moduleRemovalProblem, newModuleText, projectStreamWithModules, moduleNameMap } from '../../src/core/vba/writeback.js';
import { equalBytes } from '../../src/core/bytes.js';
import { fixture, generated } from './helpers.js';

const CODE = 'Sub Added()\n    MsgBox "added"\nEnd Sub\n';
const text = (bytes) => Buffer.from(bytes).toString('latin1');
const projectOpen = async (loader, name) => (await openWorkbook(loader(name), name)).vba.project;
const mixed = () => projectOpen(generated, 'mixed.xlsm');
const complex = () => projectOpen(fixture, 'pq_vba_complex.xlsm');
const streamOf = (project, name) => project.cfb.root.children.find((c) => c.name === name);
const names = (project) => project.modules.map((m) => m.name);
const rewrite = (project, edits = new Map(), changes = {}) => readVbaProject(writeVbaProject(project, edits, changes));

test('F2-07: an added module is read back as a standard module with its text and no anomaly', async () => {
  const project = await mixed();
  const back = rewrite(project, new Map(), { add: new Map([['Module2', CODE]]) });
  assert.deepEqual(names(back), ['Module1', 'ThisWorkbook', 'Sheet1', 'Module2']);
  assert.deepEqual(back.anomalies, []);
  assert.equal(back.writable, true);
  const added = back.modules[3];
  assert.equal(added.kind, 'standard');
  assert.equal(added.dirType, 'procedural');
  assert.equal(added.text, `Attribute VB_Name = "Module2"\r\nSub Added()\r\n    MsgBox "added"\r\nEnd Sub\r\n`);
  assert.equal(added.model.visible, CODE);
  assert.equal(newModuleText('Module2', CODE), added.text);
});

test('F2-07: the other modules keep their text and the project keeps its name, code page and references', async () => {
  const project = await mixed();
  const back = rewrite(project, new Map(), { add: new Map([['Module2', CODE]]) });
  for (const m of project.modules) assert.equal(back.modules.find((x) => x.name === m.name).text, m.text);
  assert.equal(back.projectName, project.projectName);
  assert.equal(back.codePage, project.codePage);
  assert.deepEqual(back.references, project.references);
});

test('F2-07: the dir stream gains one record group and the module count follows', async () => {
  const project = await mixed();
  const bytes = writeVbaProject(project, new Map(), { add: new Map([['Module2', CODE]]) });
  const back = readVbaProject(bytes);
  const count = back.records.find((r) => r.id === REC.MODULES);
  assert.equal(count.data[0] | (count.data[1] << 8), 4);
  const ids = back.records.map((r) => r.id);
  const group = [0x19, 0x47, 0x1a, 0x32, 0x1c, 0x48, 0x31, 0x1e, 0x2c, 0x21, 0x2b];
  const start = ids.lastIndexOf(0x19);
  assert.deepEqual(ids.slice(start, start + group.length), group);
  assert.equal(ids[start + group.length], 0x10);
  const rec = (id) => back.records[start + group.indexOf(id)];
  assert.equal(text(rec(0x19).data), 'Module2');
  assert.equal(text(rec(0x1a).data), 'Module2');
  assert.equal(Buffer.from(rec(0x47).data).toString('utf16le'), 'Module2');
  assert.equal(Buffer.from(rec(0x32).data).toString('utf16le'), 'Module2');
  assert.deepEqual([...rec(0x31).data], [0, 0, 0, 0]);
  assert.deepEqual([...rec(0x2c).data], [0xff, 0xff]);
  assert.equal(rec(0x1c).data.length, 0);
  for (const r of back.records) if (r.id !== REC.VERSION) assert.equal(r.sizeField, r.data.length);
});

test('F2-07: the PROJECT stream lists the new module after the last module line and in the workspace', async () => {
  const project = await mixed();
  const back = rewrite(project, new Map(), { add: new Map([['Module2', CODE]]) });
  const lines = text(streamOf(back, 'PROJECT').data).split('\r\n');
  const at = lines.indexOf('Module=Module2');
  assert.ok(at > 0);
  assert.equal(lines[at - 1], 'Document=Sheet1/&H00000000');
  assert.equal(lines[at + 1], 'Name="VBAProject"');
  const workspace = lines.slice(lines.indexOf('[Workspace]') + 1);
  assert.equal(workspace[workspace.indexOf('Sheet1=156, 156, 1339, 796, Z') + 1], 'Module2=0, 0, 0, 0, C');
  assert.deepEqual(back.projectInfo.modules, ['Module1', 'Module2']);
});

test('F2-07: the name map gains the new module and the rest of it is what Excel wrote', async () => {
  const project = await complex();
  const original = streamOf(project, 'PROJECTwm').data;
  assert.ok(equalBytes(moduleNameMap(project.modules.map((m) => m.name), project.codePage), original));
  const back = rewrite(project, new Map(), { add: new Map([['Module1', CODE]]) });
  const after = streamOf(back, 'PROJECTwm').data;
  assert.ok(equalBytes(after.subarray(0, original.length - 2), original.subarray(0, original.length - 2)));
  assert.ok(equalBytes(moduleNameMap(back.modules.map((m) => m.name), back.codePage), after));
});

test('F2-07: a module stream is added to the VBA storage and holds the compressed source from offset zero', async () => {
  const project = await mixed();
  const back = rewrite(project, new Map(), { add: new Map([['Module2', CODE]]) });
  const vba = back.cfb.root.children.find((c) => c.name === 'VBA');
  const node = vba.children.find((c) => c.name === 'Module2');
  assert.ok(node && node.type === 2);
  assert.equal(back.modules[3].offset, 0);
  assert.ok(equalBytes(decompress(node.data), Buffer.from(back.modules[3].text, 'latin1')));
});

test('F2-07: a removed module is gone from the records, the streams, the PROJECT stream and the name map', async () => {
  const project = await mixed();
  const back = rewrite(project, new Map(), { remove: new Set(['Module1']) });
  assert.deepEqual(names(back), ['ThisWorkbook', 'Sheet1']);
  assert.deepEqual(back.anomalies, []);
  assert.equal(back.writable, true);
  const vba = back.cfb.root.children.find((c) => c.name === 'VBA');
  assert.ok(!vba.children.some((c) => c.name === 'Module1'));
  const lines = text(streamOf(back, 'PROJECT').data).split('\r\n');
  assert.ok(!lines.some((l) => /^Module=/.test(l) || /^Module1=/.test(l)));
  assert.ok(!text(streamOf(back, 'PROJECTwm').data).includes('Module1'));
  const count = back.records.find((r) => r.id === REC.MODULES);
  assert.equal(count.data[0], 2);
  assert.equal(back.modules.find((m) => m.name === 'Sheet1').text, project.modules.find((m) => m.name === 'Sheet1').text);
});

test('F2-07: adding and then removing a module gives back the same PROJECT stream, name map and module list', async () => {
  for (const load of [mixed, complex]) {
    const project = await load();
    const added = rewrite(project, new Map(), { add: new Map([['Module9', CODE]]) });
    const gone = rewrite(added, new Map(), { remove: new Set(['Module9']) });
    assert.deepEqual(names(gone), names(project));
    assert.equal(text(streamOf(gone, 'PROJECT').data), text(streamOf(project, 'PROJECT').data));
    assert.ok(equalBytes(streamOf(gone, 'PROJECTwm').data, streamOf(project, 'PROJECTwm').data));
    assert.deepEqual(gone.records.map((r) => r.id), project.records.map((r) => r.id));
    for (const m of project.modules) assert.equal(gone.modules.find((x) => x.name === m.name).text, m.text);
  }
});

test('F2-07: add, replace and remove in one write', async () => {
  const project = await mixed();
  const edits = new Map([['Module1', 'Sub Changed()\nEnd Sub\n']]);
  const back = rewrite(project, edits, { add: new Map([['Module2', CODE]]) });
  assert.equal(back.modules.find((m) => m.name === 'Module1').model.visible, 'Sub Changed()\nEnd Sub\n');
  assert.equal(back.modules.find((m) => m.name === 'Module2').model.visible, CODE);
  const swapped = rewrite(project, new Map(), { add: new Map([['Module2', CODE]]), remove: new Set(['Module1']) });
  assert.deepEqual(names(swapped), ['ThisWorkbook', 'Sheet1', 'Module2']);
  assert.deepEqual(swapped.anomalies, []);
});

test('F2-07: the same input gives the same bytes', async () => {
  const project = await mixed();
  const a = writeVbaProject(project, new Map(), { add: new Map([['Module2', CODE]]), remove: new Set(['Module1']) });
  const b = writeVbaProject(project, new Map(), { add: new Map([['Module2', CODE]]), remove: new Set(['Module1']) });
  assert.ok(equalBytes(a, b));
});

test('F2-07: a write with no add or remove is unchanged from before', async () => {
  const project = await mixed();
  const edits = new Map([['Module1', 'Sub Changed()\nEnd Sub\n']]);
  assert.ok(equalBytes(writeVbaProject(project, edits), writeVbaProject(project, edits, { add: new Map(), remove: new Set() })));
  const dir = parseDir(decompress(streamOf(project, 'VBA').children.find((c) => c.name === 'dir').data));
  assert.equal(dir.records.length, project.records.length);
});

test('F2-07: names VBA would not accept, names already in use and names that clash with a stream are refused', async () => {
  const project = await mixed();
  const bad = ['', '1abc', 'a b', 'a-b', '_x', 'a'.repeat(32), 'Sub', 'sub', 'Module1', 'module1', 'ThisWorkbook', 'VBAProject', 'vbaproject', 'dir', 'DIR', 'PROJECT', 'é'];
  for (const name of bad) assert.ok(moduleNameProblem(project, name), JSON.stringify(name));
  for (const name of ['Module2', 'A', 'a_1', 'Utils', 'a'.repeat(31)]) assert.equal(moduleNameProblem(project, name), null, name);
  for (const name of bad) assert.throws(() => writeVbaProject(project, new Map(), { add: new Map([[name, CODE]]) }), (e) => e.code === 'vba.write', JSON.stringify(name));
});

test('F2-07: a name that is a reference library name is refused', async () => {
  const project = await complex();
  assert.ok(project.references.length > 0);
  assert.ok(moduleNameProblem(project, project.references[0]));
});

test('F2-07: two adds that differ only by case, or an add of a module that is also removed, are refused', async () => {
  const project = await mixed();
  assert.throws(() => writeVbaProject(project, new Map(), { add: new Map([['Abc', CODE], ['abc', CODE]]) }), (e) => e.code === 'vba.write');
  assert.throws(() => writeVbaProject(project, new Map(), { add: new Map([['Module1', CODE]]), remove: new Set(['Module1']) }), (e) => e.code === 'vba.write');
});

test('F2-07: only standard and class modules can be removed; sheets and the workbook cannot, and unknown names fail', async () => {
  const project = await mixed();
  assert.equal(moduleRemovalProblem(project, 'Module1'), null);
  assert.equal(moduleRemovalProblem(project, 'ThisWorkbook'), 'document');
  assert.equal(moduleRemovalProblem(project, 'Sheet1'), 'document');
  assert.equal(moduleRemovalProblem(project, 'Nope'), 'missing');
  for (const name of ['ThisWorkbook', 'Sheet1', 'Nope']) assert.throws(() => writeVbaProject(project, new Map(), { remove: new Set([name]) }), (e) => e.code === 'vba.write', name);
  assert.throws(() => writeVbaProject(project, new Map([['Module1', 'x']]), { remove: new Set(['Module1']) }), (e) => e.code === 'vba.write');
});

test('F2-07: a project that cannot be written cannot take an add or a remove', async () => {
  const project = await mixed();
  project.writable = false;
  assert.throws(() => writeVbaProject(project, new Map(), { add: new Map([['Module2', CODE]]) }), (e) => e.code === 'vba.write');
  assert.throws(() => writeVbaProject(project, new Map(), { remove: new Set(['Module1']) }), (e) => e.code === 'vba.write');
});

test('F2-07: the PROJECT stream editor keeps every other line exactly', () => {
  const source = 'ID="{X}"\r\nDocument=A/&H00000000\r\nModule=M1\r\nName="P"\r\n\r\n[Host Extender Info]\r\n&H00000001={1};VBE;&H00000000\r\n\r\n[Workspace]\r\nM1=1, 2, 3, 4, \r\nA=0, 0, 0, 0, C\r\n';
  const added = projectStreamWithModules(source, { add: ['M2'] });
  assert.equal(added, 'ID="{X}"\r\nDocument=A/&H00000000\r\nModule=M1\r\nModule=M2\r\nName="P"\r\n\r\n[Host Extender Info]\r\n&H00000001={1};VBE;&H00000000\r\n\r\n[Workspace]\r\nM1=1, 2, 3, 4, \r\nA=0, 0, 0, 0, C\r\nM2=0, 0, 0, 0, C\r\n');
  assert.equal(projectStreamWithModules(added, { remove: new Set(['M2']) }), source);
  assert.equal(projectStreamWithModules(source, { remove: new Set(['M1']) }), 'ID="{X}"\r\nDocument=A/&H00000000\r\nName="P"\r\n\r\n[Host Extender Info]\r\n&H00000001={1};VBE;&H00000000\r\n\r\n[Workspace]\r\nA=0, 0, 0, 0, C\r\n');
  assert.equal(projectStreamWithModules(source, { remove: new Set(['m1']) }).includes('Module=M1'), false);
  const none = 'ID="{X}"\r\nName="P"\r\n';
  assert.equal(projectStreamWithModules(none, { add: ['M2'] }), 'ID="{X}"\r\nModule=M2\r\nName="P"\r\n');
  assert.equal(projectStreamWithModules(source.replace(/\r\n/g, '\n'), { add: ['M2'] }).includes('\r'), false);
});

test('F2-07: an Excel-made project with protection fields keeps them when a module is added', async () => {
  const project = await complex();
  const back = rewrite(project, new Map(), { add: new Map([['Module1', CODE]]) });
  assert.equal(back.projectInfo.cmg, project.projectInfo.cmg);
  assert.equal(back.projectInfo.dpb, project.projectInfo.dpb);
  assert.equal(back.projectInfo.gc, project.projectInfo.gc);
  assert.equal(back.projectInfo.id, project.projectInfo.id);
  assert.equal(back.writable, true);
});

test('F2-07: an added module text that VBA cannot hold fails the write', async () => {
  const project = await mixed();
  assert.throws(() => writeVbaProject(project, new Map(), { add: new Map([['Module2', 'x = "\u0100"\n']]) }), (e) => e.code && e.code.startsWith('vba'));
});

test('F2-07: the PROJECT stream editor removes a class module line as well as a module line', () => {
  const source = 'ID="{X}"\r\nClass=C1\r\nModule=M1\r\nName="P"\r\n\r\n[Workspace]\r\nC1=1, 2, 3, 4, \r\nM1=0, 0, 0, 0, C\r\n';
  assert.equal(projectStreamWithModules(source, { remove: new Set(['C1']) }), 'ID="{X}"\r\nModule=M1\r\nName="P"\r\n\r\n[Workspace]\r\nM1=0, 0, 0, 0, C\r\n');
});
