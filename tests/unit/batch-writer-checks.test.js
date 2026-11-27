import test from 'node:test';
import assert from 'node:assert/strict';
import { readCfb } from '../../src/core/vba/cfb-read.js';
import { writeCfb } from '../../src/core/vba/cfb-write.js';
import { decompress } from '../../src/core/vba/ovba-decompress.js';
import { encodeText } from '../../src/core/vba/codepages.js';
import { parseDir, REC } from '../../src/core/vba/dir-stream.js';
import { readVbaProject } from '../../src/core/vba/vba-project.js';
import { writeVbaProject, verifyVbaProject } from '../../src/core/vba/writeback.js';
import { fixture } from './helpers.js';

const refuses = (fn, code, pattern) => assert.throws(fn, (e) => e.code === code && pattern.test(e.message), `${code} ${pattern}`);
const bytes = (...b) => Uint8Array.from(b);

test('decompress names the check that refused each hostile container', () => {
  refuses(() => decompress(bytes()), 'ovba.signature', /signature byte/);
  refuses(() => decompress(bytes(0x02, 0, 0)), 'ovba.signature', /signature byte/);
  refuses(() => decompress(bytes(0x01, 0x00)), 'ovba.chunk', /truncated chunk header/);
  refuses(() => decompress(bytes(0x01, 0x00, 0x00)), 'ovba.chunk', /invalid chunk signature/);
  refuses(() => decompress(bytes(0x01, 0xFF, 0xB0)), 'ovba.chunk', /chunk overruns the container/);
  refuses(() => decompress(bytes(0x01, 0x01, 0xB0, 0x01, 0x41)), 'ovba.chunk', /truncated copy token/);
  refuses(() => decompress(bytes(0x01, 0x02, 0xB0, 0x01, 0x00, 0x00)), 'ovba.offset', /start of a chunk/);
  refuses(() => decompress(bytes(0x01, 0x03, 0xB0, 0x02, 0x41, 0x00, 0x10)), 'ovba.offset', /precedes the chunk/);
  refuses(() => decompress(bytes(0x01, 0x03, 0xB0, 0x02, 0x41, 0xFD, 0x0F)), 'ovba.chunk', /runs past the chunk/);
  refuses(() => decompress(bytes(0x01, 0x04, 0xB0, 0x02, 0x41, 0xFC, 0x0F, 0x42)), 'ovba.chunk', /exceeds 4096 bytes/);
});

test('a copy that ends exactly at the end of a chunk is accepted', () => {
  const out = decompress(bytes(0x01, 0x03, 0xB0, 0x02, 0x41, 0xFC, 0x0F));
  assert.equal(out.length, 4096);
  assert.ok(out.every((b) => b === 0x41));
});

test('encodeText refuses a code page it does not know and a character the page cannot hold', () => {
  refuses(() => encodeText(99999, 'a'), 'vba.codepage', /code page 99999 is not supported/);
  refuses(() => encodeText(1252, '\u4e2d'), 'vba.codepage', /cannot be saved in code page 1252/);
});

test('parseDir reports each way a dir stream can be damaged, and nothing for a sound one', () => {
  const record = (id, data = []) => [id & 0xFF, id >> 8, data.length, 0, 0, 0, ...data];
  assert.deepEqual(parseDir(bytes(...record(0x0003, [1, 0]), ...record(REC.TERMINATOR))).anomalies, []);
  assert.deepEqual(parseDir(bytes(0x03, 0x00, 100, 0, 0, 0)).anomalies, ['dir.truncated', 'dir.trailing', 'dir.terminator']);
  assert.deepEqual(parseDir(bytes(...record(REC.TERMINATOR), 1, 2, 3)).anomalies, ['dir.trailing']);
  assert.deepEqual(parseDir(bytes(...record(0x0003, [1, 0]))).anomalies, ['dir.terminator']);
  assert.deepEqual(parseDir(bytes()).anomalies, ['dir.terminator']);
});

test('writeCfb refuses an entry name longer than 31 characters and accepts 31', () => {
  const root = (name) => ({ name: 'Root Entry', type: 5, children: [{ name, type: 2, data: bytes(1, 2, 3) }] });
  refuses(() => writeCfb(root('x'.repeat(32))), 'cfb.write', /entry name too long/);
  assert.equal(readCfb(writeCfb(root('x'.repeat(31)))).find('x'.repeat(31)).data.length, 3);
});

function withoutNode(path) {
  const cfb = readCfb(fixture('xw_vbaProject01.bin'));
  const walk = (node, trail) => {
    node.children = (node.children || []).filter((c) => [...trail, c.name].join('/') !== path);
    for (const c of node.children) if (c.children) walk(c, [...trail, c.name]);
  };
  walk(cfb.root, []);
  return writeCfb(cfb.root);
}

test('a project with no VBA/dir stream is refused, and one with no PROJECT stream is flagged', () => {
  refuses(() => readVbaProject(withoutNode('VBA/dir')), 'vba.dir', /VBA\/dir stream is missing/);
  const project = readVbaProject(withoutNode('PROJECT'));
  assert.ok(project.anomalies.includes('vba.projectStream'));
  assert.equal(project.writable, false);
  assert.ok(!readVbaProject(fixture('xw_vbaProject01.bin')).anomalies.includes('vba.projectStream'));
});

test('writeVbaProject names what is wrong with an edit', () => {
  const project = readVbaProject(fixture('xw_vbaProject01.bin'));
  assert.equal(project.writable, true);
  refuses(() => writeVbaProject(project, new Map([['NoSuchModule', 'x']])), 'vba.write', /unknown module NoSuchModule/);
  const ghost = { ...project, modules: [...project.modules, { ...project.modules[0], name: 'Ghost' }] };
  const added = new Map([['QuoinAdded', 'Sub quoin_added()\r\nEnd Sub']]);
  refuses(() => writeVbaProject(ghost, new Map(), { add: added }), 'vba.write', /module records do not match the module list/);
  assert.ok(writeVbaProject(project, new Map(), { add: added }).length > 0);
});

test('verifyVbaProject names a module that is missing or whose text changed', () => {
  const project = readVbaProject(fixture('xw_vbaProject01.bin'));
  const first = project.modules.find((m) => m.model);
  const same = new Map([[first.name, first.model.visible]]);
  assert.equal(verifyVbaProject(writeVbaProject(project, same), same).modules.length, project.modules.length);
  refuses(() => verifyVbaProject(writeVbaProject(project, same), new Map([['NoSuchModule', 'x']])), 'check.vba', /module missing after write/);
  refuses(() => verifyVbaProject(writeVbaProject(project, same), new Map([[first.name, `${first.model.visible}\n' other`]])), 'check.vba', /module text changed during write/);
});
