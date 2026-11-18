import { QuoinError } from '../errors.js';
import { base64Encode, concat, le32, u32, utf8Encode, decodeTextBytes, encodeTextBytes } from '../bytes.js';
import { crc32 } from '../crc32.js';
import { KEYWORDS, lex } from '../m/lexer.js';
import { applyEdits, attributeEdit, textContentEdit, escapeText, parseXml } from '../xml.js';
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

function appendMember(text, name, view) {
  const eol = dominantEol(text) || '\r\n';
  let expr = fromViewText(view, eol);
  if (endsInLineComment(expr)) expr += eol;
  const trailing = /\s*$/.exec(text)[0];
  return `${text.slice(0, text.length - trailing.length)}${eol}${eol}shared ${memberName(name)} = ${expr};${trailing}`;
}

function rewriteSection(text, members, queries) {
  const pieces = [];
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
  if (queries.rename.size || queries.remove.size) throw new TypeError('query rename and remove are not applied yet');
  const mashup = assertWritable(wb, queries.add.size > 0);
  checkAdds(mashup, queries.add);
  const edits = queries.replace;
  const touched = [];
  const members = mashup.split.members.filter((m) => edits.has(m.name));
  const sectionText = rewriteSection(mashup.section.text, members, queries);
  if (checkSection) {
    const problem = checkSection(sectionText);
    if (problem) throw new QuoinError('m.parse', `${problem.message} Line ${problem.line}, column ${problem.col}.`, mashup.part);
  }
  let metadata = mashup.model.raw.metadata;
  if (queries.add.size) {
    const sectionName = mashup.split.header ? mashup.split.header.name : 'Section1';
    metadata = metadataBytes(mashup.model, insertItems(mashup.model.metadata.xml, [...queries.add].map(([name, text]) => addedItem(sectionName, name, text))));
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
