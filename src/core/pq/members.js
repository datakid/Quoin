import { QuoinError } from '../errors.js';
import { base64Encode, concat, le32, u32, utf8Encode, decodeTextBytes, encodeTextBytes } from '../bytes.js';
import { crc32 } from '../crc32.js';
import { KEYWORDS, lex } from '../m/lexer.js';
import { applyEdits, attributeEdit, removeElementEdit, textContentEdit, escapeText, parseXml } from '../xml.js';
import { indexSection } from '../wb/deps.js';
import { writeZip, rawFromEntry } from '../zip-write.js';
import { SECTION_PART } from './datamashup.js';
import { dominantEol, fromViewText, memberEol } from './section.js';

const PLAIN_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

function wrapBase64(text, lineLength) {
  if (!lineLength) return text;
  const lines = [];
  for (let i = 0; i < text.length; i += lineLength) lines.push(text.slice(i, i + lineLength));
  return lines.join('\r\n');
}

function metadataBytes(model, xml) {
  const old = model.raw.metadata;
  const decoded = decodeTextBytes(old.subarray(8, 8 + u32(old, 4)));
  const body = encodeTextBytes(xml, decoded.encoding, decoded.bom);
  return concat([le32(model.metadata.version), le32(body.length), body, le32(model.metadata.content.length), model.metadata.content]);
}

async function mashupBytes(model, section, metadata, now) {
  const entries = [];
  for (const e of model.packageParts.entries) {
    if (e.name.toLowerCase() === SECTION_PART.toLowerCase()) entries.push({ name: e.name, data: encodeTextBytes(section.text, 'utf-8', section.bom) });
    else entries.push({ name: e.name, raw: rawFromEntry(e) });
  }
  const packageBytes = await writeZip(entries, { now });
  return concat([
    le32(model.version),
    le32(packageBytes.length),
    packageBytes,
    le32(model.raw.permissions.length),
    model.raw.permissions,
    le32(metadata.length),
    metadata,
    le32(model.permissionBindings.length),
    model.permissionBindings
  ]);
}

function assertWritable(wb, touchesMembers) {
  const mashup = wb.mashup;
  if (!mashup || mashup.error) throw new QuoinError('pq.format', 'no readable query data');
  if (mashup.model.warnings.length) throw new QuoinError('pq.format', mashup.model.warnings.join(','));
  if (mashup.split.errors.length) throw new QuoinError('pq.format', 'section did not split cleanly');
  if (touchesMembers && wb.warnings.some((w) => w.code === 'pq.countMismatch')) throw new QuoinError('pq.format', 'metadata does not match the section');
  return mashup;
}

export function queryNameProblem(name) {
  if (typeof name !== 'string' || !name.length) return 'empty';
  if (name !== name.trim()) return 'edge space';
  if (CONTROL.test(name)) return 'control character';
  return null;
}

const memberName = (name) => (PLAIN_NAME.test(name) && !KEYWORDS.has(name) ? name : `#"${name.replace(/"/g, '""')}"`);

function endsInLineComment(text) {
  const tokens = lex(text);
  const last = tokens[tokens.length - 1];
  return !!last && last.kind === 'comment' && last.value.startsWith('//');
}

function queryId(name, text) {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 4; i++) {
    const word = crc32(utf8Encode(`${i}|${name}|${text}`));
    bytes[i * 4] = (word >>> 24) & 255;
    bytes[i * 4 + 1] = (word >>> 16) & 255;
    bytes[i * 4 + 2] = (word >>> 8) & 255;
    bytes[i * 4 + 3] = word & 255;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function addedItem(sectionName, name, text) {
  const entries = [
    ['IsPrivate', 'l0'],
    ['FillEnabled', 'l0'],
    ['FillObjectType', 'sConnectionOnly'],
    ['FillToDataModelEnabled', 'l0'],
    ['QueryID', `s${queryId(name, text)}`],
    ['BufferNextRefresh', 'l0'],
    ['FilledCompleteResultToWorksheet', 'l0'],
    ['AddedToDataModel', 'l0']
  ];
  const body = entries.map(([type, value]) => `<Entry Type="${type}" Value="${value}" />`).join('');
  return `<Item><ItemLocation><ItemType>Formula</ItemType><ItemPath>${escapeText(`${sectionName}/${encodeURIComponent(name)}`)}</ItemPath></ItemLocation><StableEntries>${body}</StableEntries></Item>`;
}

function insertItems(xml, items) {
  const at = xml.lastIndexOf('</Items>');
  if (at < 0) throw new QuoinError('pq.format', 'metadata has no item list');
  return `${xml.slice(0, at)}${items.join('')}${xml.slice(at)}`;
}

function checkAdds(mashup, adds) {
  const taken = new Set(mashup.split.members.map((m) => m.name.toLowerCase()));
  for (const name of adds.keys()) {
    const problem = queryNameProblem(name);
    if (problem) throw new TypeError(`query name is not allowed: ${problem}`);
    if (taken.has(name.toLowerCase())) throw new TypeError(`a query named ${name} already exists`);
    taken.add(name.toLowerCase());
  }
}

export function loadTarget(query) {
  if (query.load.kind === 'table') return `${query.load.sheet}!${query.load.tableName}`;
  if (query.load.kind === 'model') return 'data model';
  return query.connection ? `connection ${query.connection.name}` : null;
}

export function queryReferencers(wb, name) {
  if (!wb.mashup || wb.mashup.error) return [];
  const index = indexSection(wb.mashup.section.text);
  const names = new Set(index.usedBy.get(name) || []);
  for (const dynamic of index.dynamic) names.add(dynamic);
  names.delete(name);
  return [...names].sort();
}

function blockingProblem(wb, name, loadedCode, usedCode) {
  const query = wb.queries.find((x) => x.name === name);
  if (!query) return null;
  const target = loadTarget(query);
  if (target) return { code: loadedCode, detail: target };
  const users = queryReferencers(wb, name);
  if (users.length) return { code: usedCode, detail: users.join(', ') };
  return null;
}

export const queryRemovalProblem = (wb, name) => blockingProblem(wb, name, 'refused.loaded', 'refused.usedBy');
export const queryRenameProblem = (wb, name) => blockingProblem(wb, name, 'refused.renameLoaded', 'refused.referenced');

function checkRemovals(wb, queries) {
  for (const name of queries.remove) {
    if (!wb.queries.some((x) => x.name === name)) throw new QuoinError('pq.unknown', name);
    if (queries.replace.has(name)) throw new TypeError(`${name} cannot be both removed and replaced`);
    const problem = queryRemovalProblem(wb, name);
    if (problem) throw new TypeError(`${problem.code}: ${problem.detail}`);
  }
}

function checkRenames(wb, mashup, queries) {
  for (const [from, to] of queries.rename) {
    if (!wb.queries.some((x) => x.name === from)) throw new QuoinError('pq.unknown', from);
    if (queries.remove.has(from)) throw new TypeError(`${from} cannot be both renamed and removed`);
    if (from === to) throw new TypeError(`${from} is renamed to the same name`);
    const nameProblem = queryNameProblem(to);
    if (nameProblem) throw new TypeError(`query name is not allowed: ${nameProblem}`);
    const problem = queryRenameProblem(wb, from);
    if (problem) throw new TypeError(`${problem.code}: ${problem.detail}`);
  }
  if (!queries.rename.size) return;
  const final = mashup.split.members.filter((m) => !queries.remove.has(m.name)).map((m) => (queries.rename.has(m.name) ? queries.rename.get(m.name) : m.name));
  const seen = new Set();
  for (const name of [...final, ...queries.add.keys()]) {
    if (seen.has(name.toLowerCase())) throw new TypeError(`more than one query would be named ${name}`);
    seen.add(name.toLowerCase());
  }
}

function* formulaItems(doc) {
  for (const item of doc.root.findAll('Item')) {
    const location = item.child('ItemLocation');
    const path = location && location.child('ItemPath');
    const type = location && location.child('ItemType');
    if (!path || !type || type.text() !== 'Formula') continue;
    const segments = path.text().split('/');
    if (segments.length < 2) continue;
    let name;
    try {
      name = decodeURIComponent(segments[1]);
    } catch {
      name = segments[1];
    }
    yield { item, path, segments, name };
  }
}

export function removeMetadataItems(xml, names) {
  const edits = [];
  for (const { item, name } of formulaItems(parseXml(xml, 'Metadata'))) if (names.has(name)) edits.push(removeElementEdit(item));
  return applyEdits(xml, edits);
}

export function renameMetadataItems(xml, renames) {
  const edits = [];
  for (const { path, segments, name } of formulaItems(parseXml(xml, 'Metadata'))) {
    if (!renames.has(name)) continue;
    const moved = segments.slice();
    moved[1] = encodeURIComponent(renames.get(name));
    edits.push(textContentEdit(path, moved.join('/')));
  }
  return applyEdits(xml, edits);
}

function removalRanges(split, remove) {
  const members = split.members;
  const ranges = [];
  let i = 0;
  while (i < members.length) {
    if (!remove.has(members[i].name)) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < members.length && remove.has(members[j + 1].name)) j++;
    const next = members[j + 1];
    if (next) ranges.push({ start: members[i].start, end: next.start });
    else ranges.push({ start: i > 0 ? members[i - 1].end : split.header ? split.header.end : 0, end: members[j].end });
    i = j + 1;
  }
  return ranges;
}

function appendMember(text, name, view) {
  const eol = dominantEol(text) || '\r\n';
  let expr = fromViewText(view, eol);
  if (endsInLineComment(expr)) expr += eol;
  const trailing = /\s*$/.exec(text)[0];
  return `${text.slice(0, text.length - trailing.length)}${eol}${eol}shared ${memberName(name)} = ${expr};${trailing}`;
}

function rewriteSection(text, split, members, queries) {
  const pieces = removalRanges(split, queries.remove).map((r) => ({ start: r.start, end: r.end, replacement: '' }));
  for (const m of split.members) if (queries.rename.has(m.name)) pieces.push({ start: m.nameStart, end: m.nameEnd, replacement: memberName(queries.rename.get(m.name)) });
  for (const m of members) {
    if (!queries.replace.has(m.name)) continue;
    const eol = memberEol(text, m);
    let replacement = fromViewText(queries.replace.get(m.name), eol);
    if (endsInLineComment(replacement)) replacement += eol;
    pieces.push({ start: m.exprStart, end: m.exprEnd, replacement });
  }
  pieces.sort((a, b) => b.start - a.start);
  let out = text;
  for (const p of pieces) out = out.slice(0, p.start) + p.replacement + out.slice(p.end);
  for (const [name, view] of queries.add) out = appendMember(out, name, view);
  return out;
}

export async function writeQueryChanges(wb, pkg, queries, { now, refreshOnLoad = true, refreshNames = new Set(), checkSection = null } = {}) {
  const mashup = assertWritable(wb, queries.add.size > 0 || queries.remove.size > 0 || queries.rename.size > 0);
  checkAdds(mashup, queries.add);
  checkRemovals(wb, queries);
  checkRenames(wb, mashup, queries);
  const edits = queries.replace;
  const touched = [];
  const members = mashup.split.members.filter((m) => edits.has(m.name));
  const sectionText = rewriteSection(mashup.section.text, mashup.split, members, queries);
  if (checkSection) {
    const problem = checkSection(sectionText);
    if (problem) throw new QuoinError('m.parse', `${problem.message} Line ${problem.line}, column ${problem.col}.`, mashup.part);
  }
  let metadata = mashup.model.raw.metadata;
  if (queries.add.size || queries.remove.size || queries.rename.size) {
    const sectionName = mashup.split.header ? mashup.split.header.name : 'Section1';
    let xml = mashup.model.metadata.xml;
    if (queries.remove.size) xml = removeMetadataItems(xml, queries.remove);
    if (queries.rename.size) xml = renameMetadataItems(xml, queries.rename);
    if (queries.add.size) xml = insertItems(xml, [...queries.add].map(([name, text]) => addedItem(sectionName, name, text)));
    metadata = metadataBytes(mashup.model, xml);
  }
  const bytes = await mashupBytes(mashup.model, { text: sectionText, bom: mashup.section.bom }, metadata, now);
  const encoded = wrapBase64(base64Encode(bytes), mashup.lineLength);
  const fresh = parseXml(mashup.text.text, mashup.part);
  const newXml = applyEdits(mashup.text.text, [textContentEdit(fresh.root, encoded)]);
  await pkg.setText(mashup.part, newXml, mashup.text);
  touched.push(mashup.part);

  const flagged = [...edits.keys()].filter((name) => refreshOnLoad || refreshNames.has(name));
  if (flagged.length && wb.connections.part) {
    const cdoc = parseXml(wb.connections.text.text, wb.connections.part);
    const conns = cdoc.root.childrenNamed('connection');
    const pieces = [];
    for (const name of flagged) {
      const q = wb.queries.find((x) => x.name === name);
      if (!q || !q.connection) continue;
      const el = conns.find((c) => c.attr('id') === q.connection.id);
      if (el && el.attr('refreshOnLoad') !== '1') pieces.push(attributeEdit(el, 'refreshOnLoad', '1'));
    }
    if (pieces.length) {
      await pkg.setText(wb.connections.part, applyEdits(wb.connections.text.text, pieces), wb.connections.text);
      touched.push(wb.connections.part);
    }
  }
  return { sectionText, touched };
}
