import test from 'node:test';
import assert from 'node:assert/strict';
import { readCfb } from '../../src/core/vba/cfb-read.js';
import { writeCfb } from '../../src/core/vba/cfb-write.js';
import { decompress } from '../../src/core/vba/ovba-decompress.js';
import { compress } from '../../src/core/vba/ovba-compress.js';
import { encodeText } from '../../src/core/vba/codepages.js';
import { parseDir, REC } from '../../src/core/vba/dir-stream.js';
import { readVbaProject } from '../../src/core/vba/vba-project.js';
import { writeVbaProject, verifyVbaProject } from '../../src/core/vba/writeback.js';
import { DEFAULT_LIMITS } from '../../src/core/limits.js';
import { parseDataMashup, readSection } from '../../src/core/pq/datamashup.js';
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

const SECTOR = 512;
const sectorAt = (n) => (n + 1) * SECTOR;
const view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const getU32 = (b, o) => view(b).getUint32(o, true);
const setU32 = (b, o, v) => view(b).setUint32(o, v >>> 0, true);
const patternOf = (n) => Uint8Array.from({ length: n }, (_, i) => (i * 7) & 255);

function cfbBase() {
  const children = [{ name: 'Small', type: 2, data: patternOf(3000) }, { name: 'Big', type: 2, data: patternOf(70000) }];
  return writeCfb({ name: 'Root Entry', type: 5, children });
}

function entriesOf(b) {
  const dirAt = sectorAt(getU32(b, 48));
  return [0, 1, 2].map((i) => {
    const at = dirAt + 128 * i;
    const length = b[at + 64] | (b[at + 65] << 8);
    let name = '';
    for (let k = 0; k < (length - 2) / 2; k++) name += String.fromCharCode(b[at + 2 * k] | (b[at + 2 * k + 1] << 8));
    return { at, name, id: i, left: getU32(b, at + 68), right: getU32(b, at + 72), child: getU32(b, at + 76), start: getU32(b, at + 116), size: getU32(b, at + 120) };
  });
}

const entry = (b, name) => entriesOf(b).find((e) => e.name === name);
const fatAt = (b, n) => sectorAt(getU32(b, 76 + 4 * Math.floor(n / 128))) + 4 * (n % 128);
const miniFatAt = (b, n) => sectorAt(getU32(b, 60)) + 4 * n;

function broken(change) {
  const b = Uint8Array.from(cfbBase());
  change(b);
  return b;
}

test('the compound file used for the reader checks is sound and has the shape the corruptions rely on', () => {
  const b = cfbBase();
  const cfb = readCfb(b);
  assert.equal(cfb.find('Small').data.length, 3000);
  assert.equal(cfb.find('Big').data.length, 70000);
  assert.deepEqual(entriesOf(b).map((e) => e.name).sort(), ['Big', 'Root Entry', 'Small']);
  assert.equal(getU32(b, 44), 2);
  assert.ok(getU32(b, 60) !== 0xFFFFFFFE);
});

test('readCfb names the header check that refused a file', () => {
  refuses(() => readCfb(new Uint8Array(600)), 'cfb.header', /signature mismatch/);
  refuses(() => readCfb(cfbBase().slice(0, 100)), 'cfb.header', /signature mismatch/);
  refuses(() => readCfb(broken((b) => { b[28] = 0xFF; b[29] = 0xFE; })), 'cfb.header', /byte order/);
  refuses(() => readCfb(broken((b) => { b[26] = 5; })), 'cfb.header', /version or sector size/);
  refuses(() => readCfb(broken((b) => { b[30] = 12; })), 'cfb.header', /version or sector size/);
  refuses(() => readCfb(broken((b) => { b[32] = 7; })), 'cfb.header', /mini sector size/);
});

test('readCfb refuses a file with too many sectors, and a header that claims too many FAT sectors', () => {
  refuses(() => readCfb(cfbBase(), { ...DEFAULT_LIMITS, maxCfbSectors: 2 }), 'limit.cfb', /too many sectors/);
  refuses(() => readCfb(broken((b) => setU32(b, 44, 0x7FFFFFFF))), 'limit.cfb', /too many FAT sectors/);
});

test('readCfb refuses a DIFAT chain that loops and a sector number past the end of the file', () => {
  refuses(() => readCfb(broken((b) => {
    const dir = getU32(b, 48);
    setU32(b, 72, 2);
    setU32(b, 68, dir);
    setU32(b, sectorAt(dir) + 508, dir);
  })), 'cfb.loop', /DIFAT chain loops/);
  refuses(() => readCfb(broken((b) => setU32(b, 48, 99999))), 'cfb.range', /sector 99999 is out of range/);
});

test('readCfb names what is wrong with a FAT chain', () => {
  const second = (b) => getU32(b, fatAt(b, entry(b, 'Big').start));
  refuses(() => readCfb(broken((b) => setU32(b, entry(b, 'Big').at + 116, 0xFFFFFFFF))), 'cfb.chain', /special sector/);
  refuses(() => readCfb(broken((b) => setU32(b, fatAt(b, entry(b, 'Big').start), 0xFFFFFFFD))), 'cfb.chain', /special sector/);
  refuses(() => readCfb(broken((b) => setU32(b, fatAt(b, second(b)), entry(b, 'Big').start))), 'cfb.loop', /FAT chain loops/);
  refuses(() => readCfb(broken((b) => setU32(b, 44, 1))), 'cfb.range', /FAT index out of range/);
  refuses(() => readCfb(broken((b) => setU32(b, entry(b, 'Big').at + 120, 200000))), 'cfb.short', /stream shorter than its declared size/);
});

test('readCfb refuses a directory with no root entry, an object of an unknown type, and a tree that loops or leaves the directory', () => {
  refuses(() => readCfb(broken((b) => { b[entry(b, 'Root Entry').at + 66] = 2; })), 'cfb.root', /root entry missing/);
  refuses(() => readCfb(broken((b) => { b[entry(b, 'Small').at + 66] = 3; })), 'cfb.type', /unexpected object type 3/);
  refuses(() => readCfb(broken((b) => setU32(b, entry(b, 'Root Entry').at + 76, 99))), 'cfb.range', /directory id out of range/);
  refuses(() => readCfb(broken((b) => {
    const top = entriesOf(b)[0].child;
    setU32(b, entriesOf(b)[top].at + 72, top);
  })), 'cfb.loop', /directory tree loops/);
});

test('readCfb names what is wrong with a chain in the mini stream', () => {
  const small = (b) => entry(b, 'Small');
  refuses(() => readCfb(broken((b) => setU32(b, miniFatAt(b, small(b).start), small(b).start))), 'cfb.loop', /MiniFAT chain loops/);
  refuses(() => readCfb(broken((b) => setU32(b, small(b).at + 116, 99999))), 'cfb.range', /mini sector out of range/);
  refuses(() => readCfb(broken((b) => setU32(b, small(b).at + 120, 100))), 'cfb.loop', /mini chain longer than the stream/);
  refuses(() => readCfb(broken((b) => setU32(b, miniFatAt(b, getU32(b, miniFatAt(b, small(b).start))), 0xFFFFFFFE))), 'cfb.short', /mini stream shorter than its declared size/);
});

test('a package that is not a zip is refused as a package problem, and a package with no section is refused', async () => {
  const junk = bytes(0, 0, 0, 0, 4, 0, 0, 0, 74, 85, 78, 75, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  refuses(() => parseDataMashup(junk), 'pq.package', /./);
  await assert.rejects(() => readSection({ packageParts: new Map() }), (e) => e.code === 'pq.section' && /Formulas\/Section1\.m is missing/.test(e.message));
});


test('a VBA/dir stream that cannot be decompressed is reported as a dir problem', () => {
  const cfb = readCfb(fixture('xw_vbaProject01.bin'));
  cfb.find('VBA/dir').data[0] = 2;
  refuses(() => readVbaProject(writeCfb(cfb.root)), 'vba.dir', /signature byte/);
});

test('a project whose dir stream has trailing bytes can be read but is not writable', () => {
  const cfb = readCfb(fixture('xw_vbaProject01.bin'));
  const node = cfb.find('VBA/dir');
  node.data = compress(Uint8Array.from([...decompress(node.data), 1, 2, 3]));
  const project = readVbaProject(writeCfb(cfb.root));
  assert.ok(project.anomalies.includes('dir.trailing'));
  assert.equal(project.writable, false);
  assert.equal(readVbaProject(fixture('xw_vbaProject01.bin')).writable, true);
});

