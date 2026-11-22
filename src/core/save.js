import { QuoinError } from './errors.js';
import { removeVbaSignatures } from './opc.js';
import { changedQueryEdits } from './pq/writeback.js';
import { writeQueryChanges } from './pq/members.js';
import { writeVbaProject } from './vba/writeback.js';
import { openWorkbook } from './workbook.js';
import { equalBytes } from './bytes.js';
import { suggestedFileName } from './filename.js';
import { addSheetsToPackage, verifyAddedSheets } from './sheet/add-sheets.js';
import { writeRangesToPackage, verifyWrittenRanges } from './sheet/write-ranges.js';

export { suggestedFileName };

export function changedVbaEdits(wb, edits) {
  const out = new Map();
  if (!wb.vba || !wb.vba.project) return out;
  for (const [name, view] of edits) {
    const m = wb.vba.project.modules.find((x) => x.name === name);
    if (!m || !m.model) throw new QuoinError('vba.unknown', name);
    if (view !== m.model.visible) out.set(name, view);
  }
  return out;
}

export function emptyChangeSet() {
  return {
    queries: { add: new Map(), replace: new Map(), rename: new Map(), remove: new Set() },
    modules: { add: new Map(), replace: new Map(), remove: new Set() },
    sheets: { add: [], write: [] },
    refreshOnLoad: new Set(),
    acknowledgeSignature: false
  };
}

function completeChangeSet(changeSet) {
  const base = emptyChangeSet();
  return {
    queries: { ...base.queries, ...(changeSet.queries || {}) },
    modules: { ...base.modules, ...(changeSet.modules || {}) },
    sheets: { ...base.sheets, ...(changeSet.sheets || {}) },
    refreshOnLoad: changeSet.refreshOnLoad || base.refreshOnLoad,
    acknowledgeSignature: !!changeSet.acknowledgeSignature
  };
}

export async function buildWorkbook(wb, { queryEdits = new Map(), vbaEdits = new Map(), refreshOnLoad = true, checkSection = null, acknowledgeSignature = false, faultInject = false } = {}) {
  const cs = emptyChangeSet();
  for (const [name, text] of changedQueryEdits(wb, queryEdits)) cs.queries.replace.set(name, text);
  for (const [name, view] of changedVbaEdits(wb, vbaEdits)) cs.modules.replace.set(name, view);
  cs.acknowledgeSignature = acknowledgeSignature;
  return applyChangeSet(wb, cs, { refreshOnLoad, checkSection, faultInject });
}

export async function applyChangeSet(wb, changeSet, { now, refreshOnLoad = true, checkSection = null, faultInject = false } = {}) {
  const cs = completeChangeSet(changeSet);
  const pkg = wb.pkg.clone();
  const touched = new Set();
  const q = cs.queries;
  if (q.add.size || q.replace.size || q.rename.size || q.remove.size) {
    const written = await writeQueryChanges(wb, pkg, q, { now, refreshOnLoad, refreshNames: cs.refreshOnLoad, checkSection });
    for (const part of written.touched) touched.add(part);
  }
  const addedParts = new Set();
  const partTexts = new Map();
  const insertions = new Map();
  let signatureRemoved = false;
  if (cs.modules.replace.size || cs.modules.add.size || cs.modules.remove.size) {
    if (!wb.vba || !wb.vba.project) throw new QuoinError('vba.unreadable', 'no readable VBA project');
    if (wb.vba.signed && !cs.acknowledgeSignature) throw new QuoinError('vba.signature', 'signature removal was not confirmed');
    const bytes = writeVbaProject(wb.vba.project, cs.modules.replace, { add: cs.modules.add, remove: cs.modules.remove });
    pkg.set(wb.vba.part, bytes);
    touched.add(wb.vba.part);
    if (wb.vba.signed) {
      await removeVbaSignatures(pkg);
      signatureRemoved = true;
    }
  }
  if (cs.sheets.add.length) {
    const written = await addSheetsToPackage(wb, pkg, cs.sheets.add);
    for (const part of written.touched) touched.add(part);
    for (const part of written.addedParts) addedParts.add(part);
    for (const [part, text] of written.texts) partTexts.set(part, text);
    for (const [part, ins] of written.insertions) insertions.set(part, ins);
  }
  if (cs.sheets.write.length) {
    const written = await writeRangesToPackage(wb, pkg, cs.sheets.write);
    for (const part of written.touched) touched.add(part);
    for (const [part, text] of written.texts) partTexts.set(part, text);
  }
  const bytes = await pkg.write({ now });
  if (faultInject) throw new QuoinError('write.selfcheck', 'injected fault');
  await selfCheck(wb, bytes, { changes: cs, touched, addedParts, removedParts: new Set(), signatureRemoved, partTexts, insertions });
  return {
    bytes,
    name: suggestedFileName(wb),
    queriesChanged: q.add.size + q.replace.size + q.rename.size + q.remove.size,
    modulesChanged: cs.modules.add.size + cs.modules.replace.size + cs.modules.remove.size,
    signatureRemoved
  };
}

function expectedQueries(wb, q) {
  const out = new Map();
  for (const x of wb.queries) {
    if (q.remove.has(x.name)) continue;
    out.set(q.rename.get(x.name) || x.name, { text: q.replace.has(x.name) ? q.replace.get(x.name) : x.original, kind: q.replace.has(x.name) ? 'replaced' : 'untouched' });
  }
  for (const [name, text] of q.add) out.set(name, { text, kind: 'added' });
  return out;
}

function expectedModules(wb, m) {
  const out = new Map();
  for (const x of wb.vba && wb.vba.project ? wb.vba.project.modules : []) {
    if (m.remove.has(x.name)) continue;
    out.set(x.name, m.replace.has(x.name) ? { text: m.replace.get(x.name), edited: true } : { text: x.text, edited: false });
  }
  for (const [name, text] of m.add) out.set(name, { text, edited: true });
  return out;
}

function withoutCounts(text, elements) {
  return elements.length ? text.replace(new RegExp(`(<(?:${elements.join('|')})\\b[^>]*?)\\s+count="\\d+"`, 'g'), '$1') : text;
}

function removable(text, fragments, original) {
  if (!fragments.length) return text === original;
  const [first, ...rest] = fragments;
  for (let at = text.indexOf(first); at !== -1; at = text.indexOf(first, at + 1)) if (removable(text.slice(0, at) + text.slice(at + first.length), rest, original)) return true;
  return false;
}

function onlyInsertions(original, output, { fragments, countElements }) {
  return removable(withoutCounts(output, countElements), fragments, withoutCounts(original, countElements));
}

export async function selfCheck(wb, bytes, { changes, touched, addedParts, removedParts, signatureRemoved, partTexts = new Map(), insertions = new Map() }) {
  try {
    const back = await openWorkbook(bytes, wb.fileName, wb.limits);
    const knownWarnings = new Set(wb.warnings.map((w) => w.code));
    for (const w of back.warnings) if (w.code.startsWith('pq.') && !knownWarnings.has(w.code)) throw new QuoinError('check.query', `new warning ${w.code}`, w.part || '');
    const wantQueries = expectedQueries(wb, changes.queries);
    for (const got of back.queries) if (!wantQueries.has(got.name)) throw new QuoinError('check.query', 'query was not declared', got.name);
    for (const [name, want] of wantQueries) {
      const got = back.queries.find((x) => x.name === name);
      if (!got) throw new QuoinError('check.query', want.kind === 'untouched' ? 'untouched query is missing' : `${want.kind} query is missing`, name);
      if (got.original !== want.text) throw new QuoinError('check.query', want.kind === 'untouched' ? 'untouched query changed' : 'query text differs after write', name);
    }
    if (back.queries.length !== wantQueries.size) throw new QuoinError('check.query', 'query count changed');
    const m = changes.modules;
    if (m.replace.size || m.add.size || m.remove.size) {
      const wantModules = expectedModules(wb, m);
      const backModules = back.vba && back.vba.project ? back.vba.project.modules : [];
      for (const [name, want] of wantModules) {
        const got = backModules.find((x) => x.name === name);
        if (!got) throw new QuoinError('check.vba', 'module is missing after write', name);
        if (want.edited ? !got.model || got.model.visible !== want.text : got.text !== want.text) throw new QuoinError('check.vba', want.edited ? 'module text differs after write' : 'untouched module changed', name);
      }
      for (const got of backModules) if (!wantModules.has(got.name)) throw new QuoinError('check.vba', 'module was not declared', got.name);
      for (const name of m.add.keys()) if (backModules.find((x) => x.name === name).kind !== 'standard') throw new QuoinError('check.vba', 'added module is not a standard module', name);
      const knownAnomalies = new Set(wb.vba.project.anomalies);
      for (const code of back.vba.project.anomalies) if (!knownAnomalies.has(code)) throw new QuoinError('check.vba', `new anomaly ${code}`, code);
    }
    if (changes.sheets.add.length) await verifyAddedSheets(back, wb, changes.sheets.add);
    if (changes.sheets.write.length) await verifyWrittenRanges(back, wb, changes.sheets.write);
    for (const entry of back.pkg.zip.entries) await entry.read();
    const original = new Set(wb.pkg.zip.entries.map((e) => e.name));
    const present = new Set(back.pkg.zip.entries.map((e) => e.name));
    for (const name of present) if (!original.has(name) && !addedParts.has(name)) throw new QuoinError('check.part', 'part was not declared', name);
    for (const name of addedParts) if (!present.has(name)) throw new QuoinError('check.part', 'declared part is missing', name);
    for (const name of removedParts) if (present.has(name)) throw new QuoinError('check.part', 'declared removal is still present', name);
    const signatureParts = signatureRemoved ? (n) => /vbaProjectSignature/i.test(n) || /vbaProject\.bin\.rels$/i.test(n) || n === '[Content_Types].xml' : () => false;
    for (const [name, text] of partTexts) {
      const got = await back.pkg.text(name);
      if (got.text !== text) throw new QuoinError('check.part', 'part differs from what was written', name);
    }
    for (const [name, ins] of insertions) {
      const got = await back.pkg.text(name);
      const original = await wb.pkg.text(name);
      if (!onlyInsertions(original.text, got.text, ins)) throw new QuoinError('check.part', 'part changed beyond what was inserted', name);
    }
    for (const e of wb.pkg.zip.entries) {
      if (touched.has(e.name) || removedParts.has(e.name) || signatureParts(e.name)) continue;
      const n = back.pkg.zip.get(e.name);
      if (!n || !equalBytes(n.rawCompressed(), e.rawCompressed()) || n.crc32 !== e.crc32) throw new QuoinError('check.part', 'part changed unexpectedly', e.name);
    }
  } catch (e) {
    if (e instanceof QuoinError) throw new QuoinError('write.selfcheck', `${e.code}${e.part ? ` ${e.part}` : ''}`, e.part);
    throw new QuoinError('write.selfcheck', String(e && e.message));
  }
}
