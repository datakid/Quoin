import { QuoinError } from '../errors.js';
import { compress } from './ovba-compress.js';
import { decompress } from './ovba-decompress.js';
import { REC, serializeDir } from './dir-stream.js';
import { decodeBytes, encodeText } from './codepages.js';
import { joinModuleSource, splitLines } from './module-source.js';
import { writeCfb } from './cfb-write.js';
import { readVbaProject } from './vba-project.js';
import { concat, equalBytes } from '../bytes.js';

export const MINIMAL_VBA_PROJECT = new Uint8Array([0xCC, 0x61, 0xFF, 0xFF, 0x00, 0x00, 0x00]);

export function composeModuleText(mod, editedView) {
  return joinModuleSource(mod.model, editedView);
}

const RESERVED = new Set([
  'and', 'as', 'boolean', 'byref', 'byte', 'byval', 'call', 'case', 'const', 'currency', 'date', 'dim', 'do', 'double', 'each', 'else', 'elseif', 'empty', 'end', 'enum', 'eqv', 'erase', 'error', 'event', 'exit', 'false', 'for', 'friend', 'function', 'get', 'global', 'gosub', 'goto', 'if', 'imp', 'implements', 'in', 'integer', 'is', 'let', 'like', 'long', 'loop', 'lset', 'me', 'mod', 'new', 'next', 'not', 'nothing', 'null', 'object', 'on', 'option', 'optional', 'or', 'paramarray', 'preserve', 'private', 'property', 'public', 'raiseevent', 'redim', 'rem', 'resume', 'return', 'rset', 'select', 'set', 'single', 'static', 'step', 'stop', 'string', 'sub', 'then', 'to', 'true', 'type', 'typeof', 'until', 'variant', 'wend', 'while', 'with', 'withevents', 'xor'
]);

const utf16 = (text) => {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    out[i * 2] = text.charCodeAt(i) & 0xFF;
    out[i * 2 + 1] = text.charCodeAt(i) >> 8;
  }
  return out;
};

const record = (id, data) => ({ id, sizeField: data.length, data });
const word32 = (n) => Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);

export function moduleNameProblem(project, name) {
  if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(name)) return 'name';
  const lower = name.toLowerCase();
  if (RESERVED.has(lower)) return 'reserved';
  if (project.modules.some((m) => m.name.toLowerCase() === lower)) return 'exists';
  if (project.projectName && project.projectName.toLowerCase() === lower) return 'project';
  if (project.references.some((r) => r.toLowerCase() === lower)) return 'reference';
  const root = project.cfb.root;
  const vba = root.children.find((c) => c.name.toLowerCase() === 'vba');
  const taken = [...root.children, ...(vba ? vba.children : [])];
  if (taken.some((c) => c.name.toLowerCase() === lower)) return 'stream';
  return null;
}

export function moduleRemovalProblem(project, name) {
  const mod = project.modules.find((m) => m.name === name);
  if (!mod) return 'missing';
  return mod.kind === 'standard' || mod.kind === 'class' ? null : mod.kind;
}

export function newModuleText(name, view) {
  return `Attribute VB_Name = "${name}"\r\n${splitLines(view).join('\r\n')}`;
}

export function moduleNameMap(names, codePage) {
  const parts = [];
  for (const name of names) parts.push(encodeText(codePage, name), Uint8Array.of(0), utf16(name), Uint8Array.of(0, 0));
  parts.push(Uint8Array.of(0, 0));
  return concat(parts);
}

export function projectStreamWithModules(text, { add = [], remove = new Set() } = {}) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const gone = new Set([...remove].map((n) => n.toLowerCase()));
  const kept = [];
  let section = 'main';
  for (const line of text.split(eol)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) section = trimmed.slice(1, -1).toLowerCase();
    else if (section === 'main') {
      const m = /^(Module|Class)=(.*)$/i.exec(trimmed);
      if (m && gone.has(m[2].trim().toLowerCase())) continue;
    } else if (section === 'workspace') {
      const eq = trimmed.indexOf('=');
      if (eq > 0 && gone.has(trimmed.slice(0, eq).trim().toLowerCase())) continue;
    }
    kept.push(line);
  }
  if (!add.length) return kept.join(eol);
  let mainEnd = kept.findIndex((l) => l.trim().startsWith('['));
  if (mainEnd < 0) mainEnd = kept.length;
  let after = -1;
  for (let i = 0; i < mainEnd; i++) if (/^(Document|Module|Class|BaseClass|Package)=/i.test(kept[i].trim())) after = i;
  if (after < 0) for (let i = 0; i < mainEnd; i++) if (/^ID=/i.test(kept[i].trim())) after = i;
  kept.splice(after + 1, 0, ...add.map((n) => `Module=${n}`));
  const header = kept.findIndex((l) => l.trim().toLowerCase() === '[workspace]');
  if (header >= 0) {
    let end = kept.length;
    for (let i = header + 1; i < kept.length; i++) {
      if (kept[i].trim().startsWith('[')) {
        end = i;
        break;
      }
    }
    let last = header;
    for (let i = header + 1; i < end; i++) if (kept[i].trim()) last = i;
    kept.splice(last + 1, 0, ...add.map((n) => `${n}=0, 0, 0, 0, C`));
  }
  return kept.join(eol);
}

function moduleGroups(records, count) {
  const groups = [];
  let inModules = false;
  let start = -1;
  records.forEach((r, i) => {
    if (r.id === REC.MODULES) inModules = true;
    else if (inModules && r.id === REC.MODULE_NAME && start < 0) start = i;
    else if (inModules && r.id === REC.MODULE_TERMINATOR && start >= 0) {
      groups.push({ start, end: i });
      start = -1;
    }
  });
  if (groups.length !== count) throw new QuoinError('vba.write', 'module records do not match the module list');
  return groups;
}

function groupFor(name, codePage) {
  const none = new Uint8Array(0);
  return [
    record(REC.MODULE_NAME, encodeText(codePage, name)),
    record(REC.MODULE_NAME_UNICODE, utf16(name)),
    record(REC.MODULE_STREAM_NAME, encodeText(codePage, name)),
    record(REC.STREAM_NAME_UNICODE, utf16(name)),
    record(REC.MODULE_DOCSTRING, none),
    record(REC.MODULE_DOCSTRING_UNICODE, none),
    record(REC.MODULE_OFFSET, word32(0)),
    record(REC.MODULE_HELP_CONTEXT, word32(0)),
    record(REC.MODULE_COOKIE, Uint8Array.of(0xFF, 0xFF)),
    record(REC.MODULE_TYPE_PROCEDURAL, none),
    record(REC.MODULE_TERMINATOR, none)
  ];
}

export function writeVbaProject(project, edits, { add = new Map(), remove = new Set() } = {}) {
  if (!project.writable) throw new QuoinError('vba.write', 'this project cannot be written');
  const encoded = new Map();
  const compressedOf = (name, text, originalBytes) => {
    const bytes = encodeText(project.codePage, text, originalBytes);
    const compressed = compress(bytes);
    if (!equalBytes(decompress(compressed), bytes)) throw new QuoinError('vba.compress', 'module did not survive compression', name);
    return compressed;
  };
  for (const name of remove) {
    const problem = moduleRemovalProblem(project, name);
    if (problem) throw new QuoinError('vba.write', `module ${name} cannot be removed: ${problem}`, name);
    if (edits.has(name)) throw new QuoinError('vba.write', `module ${name} is both edited and removed`, name);
  }
  for (const [name, view] of edits) {
    const mod = project.modules.find((m) => m.name === name);
    if (!mod) throw new QuoinError('vba.write', `unknown module ${name}`, name);
    if (remove.has(name)) continue;
    encoded.set(name, compressedOf(name, composeModuleText(mod, view), mod.sourceBytes));
  }
  const added = [];
  const seen = new Set();
  for (const [name, view] of add) {
    const problem = moduleNameProblem(project, name);
    if (problem) throw new QuoinError('vba.write', `module ${name} cannot be added: ${problem}`, name);
    if (seen.has(name.toLowerCase())) throw new QuoinError('vba.write', `module ${name} is added twice`, name);
    seen.add(name.toLowerCase());
    added.push({ name, compressed: compressedOf(name, newModuleText(name, view)) });
  }
  const listChanged = remove.size > 0 || added.length > 0;
  let records = project.records.map((r) => ({ ...r }));
  const root = structuredCloneNode(project.cfb.root);
  const vba = root.children.find((c) => c.name.toLowerCase() === 'vba');
  for (const mod of project.modules) {
    if (remove.has(mod.name)) continue;
    const stream = vba.children.find((c) => c.name.toLowerCase() === mod.streamName.toLowerCase());
    stream.data = encoded.get(mod.name) || mod.compressedFrom;
    records[mod.offsetRecord] = { ...records[mod.offsetRecord], data: new Uint8Array(4) };
  }
  const survivors = project.modules.filter((m) => !remove.has(m.name));
  if (listChanged) {
    const groups = moduleGroups(records, project.modules.length);
    const dropped = new Set();
    project.modules.forEach((m, i) => {
      if (remove.has(m.name)) for (let k = groups[i].start; k <= groups[i].end; k++) dropped.add(k);
    });
    records = records.filter((_, i) => !dropped.has(i));
    const terminator = records.map((r) => r.id).lastIndexOf(REC.TERMINATOR);
    records.splice(terminator, 0, ...added.flatMap((a) => groupFor(a.name, project.codePage)));
    const countAt = records.findIndex((r) => r.id === REC.MODULES);
    const total = survivors.length + added.length;
    records[countAt] = record(REC.MODULES, Uint8Array.of(total & 255, total >> 8));
    const gone = new Set([...remove].map((n) => project.modules.find((m) => m.name === n).streamName.toLowerCase()));
    vba.children = vba.children.filter((c) => !gone.has(c.name.toLowerCase()));
    for (const a of added) vba.children.push({ name: a.name, path: `VBA/${a.name}`, type: 2, clsid: new Uint8Array(16), stateBits: 0, created: new Uint8Array(8), modified: new Uint8Array(8), data: a.compressed });
    const projectNode = root.children.find((c) => c.name === 'PROJECT');
    if (projectNode) {
      const edited = projectStreamWithModules(decodeBytes(project.codePage, projectNode.data), { add: added.map((a) => a.name), remove });
      projectNode.data = encodeText(project.codePage, edited, projectNode.data);
    }
    const mapNode = root.children.find((c) => c.name === 'PROJECTwm');
    if (mapNode) mapNode.data = moduleNameMap([...survivors.map((m) => m.name), ...added.map((a) => a.name)], project.codePage);
  }
  const dirNode = vba.children.find((c) => c.name.toLowerCase() === 'dir');
  dirNode.data = compress(serializeDir(records));
  const pc = vba.children.find((c) => c.name === '_VBA_PROJECT');
  if (pc) pc.data = MINIMAL_VBA_PROJECT;
  vba.children = vba.children.filter((c) => !/^__SRP_/i.test(c.name));
  for (const a of added) {
    const node = vba.children.find((c) => c.name === a.name);
    if (!node) throw new QuoinError('vba.write', 'added module stream was lost', a.name);
  }
  return writeCfb(root);
}

function structuredCloneNode(n) {
  return { ...n, children: n.children ? n.children.map(structuredCloneNode) : undefined };
}

export function verifyVbaProject(bytes, expected) {
  const back = readVbaProject(bytes);
  for (const [name, view] of expected) {
    const mod = back.modules.find((m) => m.name === name);
    if (!mod || !mod.model) throw new QuoinError('check.vba', 'module missing after write', name);
    if (mod.model.visible !== view) throw new QuoinError('check.vba', 'module text changed during write', name);
  }
  return back;
}
