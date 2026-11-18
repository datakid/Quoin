import { QuoinError } from '../errors.js';
import { base64Encode, concat, le32, encodeTextBytes } from '../bytes.js';
import { applyEdits, attributeEdit, textContentEdit, parseXml } from '../xml.js';
import { writeZip, rawFromEntry } from '../zip-write.js';
import { SECTION_PART } from './datamashup.js';
import { rebuildSection } from './section.js';

function wrapBase64(text, lineLength) {
  if (!lineLength) return text;
  const lines = [];
  for (let i = 0; i < text.length; i += lineLength) lines.push(text.slice(i, i + lineLength));
  return lines.join('\r\n');
}

async function mashupBytes(model, section, now) {
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
    le32(model.raw.metadata.length),
    model.raw.metadata,
    le32(model.permissionBindings.length),
    model.permissionBindings
  ]);
}

function assertWritable(wb) {
  const mashup = wb.mashup;
  if (!mashup || mashup.error) throw new QuoinError('pq.format', 'no readable query data');
  if (mashup.model.warnings.length) throw new QuoinError('pq.format', mashup.model.warnings.join(','));
  if (mashup.split.errors.length) throw new QuoinError('pq.format', 'section did not split cleanly');
  return mashup;
}

export async function writeQueryChanges(wb, pkg, queries, { now, refreshOnLoad = true, refreshNames = new Set(), checkSection = null } = {}) {
  if (queries.add.size || queries.rename.size || queries.remove.size) throw new TypeError('query add, rename and remove are not applied yet');
  const mashup = assertWritable(wb);
  const edits = queries.replace;
  const touched = [];
  const members = mashup.split.members.filter((m) => edits.has(m.name));
  const sectionText = rebuildSection(mashup.section.text, members, new Map(edits));
  if (checkSection) {
    const problem = checkSection(sectionText);
    if (problem) throw new QuoinError('m.parse', `${problem.message} Line ${problem.line}, column ${problem.col}.`, mashup.part);
  }
  const bytes = await mashupBytes(mashup.model, { text: sectionText, bom: mashup.section.bom }, now);
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
