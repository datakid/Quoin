import { openMessage } from '../batch/protocol.js';
import { refusalByName } from '../batch/index/file-index.js';
import { isRecipeFileName } from './recipe-files.js';

const byRelPath = (a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0);

const refOf = (file, relPath) => ({ name: file.name, relPath, size: file.size, lastModified: file.lastModified, file });

export function snapshotDrop(dt) {
  const items = [...(dt.items || [])].filter((it) => it.kind === 'file');
  const entries = items.map((it) => (typeof it.webkitGetAsEntry === 'function' ? it.webkitGetAsEntry() : null));
  return { entries: entries.length && entries.every(Boolean) ? entries : null, files: [...(dt.files || [])] };
}

export function splitRecipe(snapshot) {
  const recipes = snapshot.files.filter((f) => isRecipeFileName(f.name));
  if (!recipes.length) return { recipes, rest: snapshot };
  const entries = snapshot.entries ? snapshot.entries.filter((e) => !(e.isFile && isRecipeFileName(e.name))) : null;
  return { recipes, rest: { entries, files: snapshot.files.filter((f) => !isRecipeFileName(f.name)) } };
}

export const hasFolder = (snapshot) => !!snapshot.entries && snapshot.entries.some((e) => e.isDirectory);

const pathOf = (entry) => String(entry.fullPath || entry.name).replace(/^\/+/, '');

const fileOf = (entry) => new Promise((resolve, reject) => entry.file(resolve, reject));

const readBatch = (reader) => new Promise((resolve, reject) => reader.readEntries(resolve, reject));

async function walk(entry, out, unreadable) {
  if (entry.isFile) {
    try {
      out.push(refOf(await fileOf(entry), pathOf(entry)));
    } catch {
      unreadable.push(pathOf(entry));
    }
    return;
  }
  if (!entry.isDirectory || typeof entry.createReader !== 'function') return;
  const reader = entry.createReader();
  try {
    for (let batch = await readBatch(reader); batch.length; batch = await readBatch(reader)) {
      for (const child of batch) await walk(child, out, unreadable);
    }
  } catch {
    unreadable.push(pathOf(entry));
  }
}

export async function collectFiles(snapshot) {
  const files = [];
  const unreadable = [];
  if (snapshot.entries) for (const entry of snapshot.entries) await walk(entry, files, unreadable);
  else for (const f of snapshot.files) files.push(refOf(f, f.webkitRelativePath || f.name));
  return { files: files.sort(byRelPath), unreadable };
}

export function filesFromInput(list) {
  return [...list].map((f) => refOf(f, f.webkitRelativePath || f.name)).sort(byRelPath);
}

const inflight = new WeakMap();

export async function indexPending(session, pool) {
  const active = inflight.get(session) || new Set();
  inflight.set(session, active);
  const todo = session.list().filter((f) => f.status === 'pending' && !active.has(f.id));
  await Promise.all(
    todo.map(async (f) => {
      const code = refusalByName(f.name);
      if (code) {
        session.refused(f.id, code);
        return;
      }
      active.add(f.id);
      try {
        const r = await pool.submit({ message: openMessage({ id: f.id, name: f.name, relPath: f.relPath, size: f.size, lastModified: f.lastModified, file: f.file }) });
        if (r.status === 'failed') session.failed(f.id, r.error);
        else if (r.status === 'done') {
          if (r.message.type === 'opened') session.indexed(f.id, r.message.index);
          else session.refused(f.id, r.message.code);
        }
      } finally {
        active.delete(f.id);
      }
    })
  );
}
