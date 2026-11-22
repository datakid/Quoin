import { equalBytes } from '../core/bytes.js';
import { releasedFiles, fillOutputs, reportCsvBytes } from './outputs.js';

export const hasDirectoryPicker = (host = window) => typeof host.showDirectoryPicker === 'function';

const isMissing = (e) => !!e && e.name === 'NotFoundError';

function split(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? { stem: name.slice(0, dot), ext: name.slice(dot) } : { stem: name, ext: '' };
}

async function freeName(dir, name) {
  const { stem, ext } = split(name);
  let candidate = name;
  let n = 2;
  for (;;) {
    try {
      await dir.getFileHandle(candidate);
    } catch (e) {
      if (isMissing(e)) return candidate;
      throw e;
    }
    candidate = `${stem}-${n++}${ext}`;
  }
}

async function folderFor(root, parts) {
  let dir = root;
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
  return dir;
}

async function writeOne(root, path, data) {
  const parts = path.split('/');
  const name = parts.pop();
  const dir = await folderFor(root, parts);
  const finalName = await freeName(dir, name);
  const handle = await dir.getFileHandle(finalName, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(data);
    await writable.close();
  } catch (e) {
    try {
      await writable.abort();
    } catch {
      throw e;
    }
    throw e;
  }
  const back = new Uint8Array(await (await handle.getFile()).arrayBuffer());
  if (!equalBytes(back, data)) {
    try {
      await dir.removeEntry(finalName);
    } catch {
      throw new Error('write.verify');
    }
    throw new Error('write.verify');
  }
  return [...parts, finalName].join('/');
}

export async function buildFolderOutput(root, { plan, indexes, perFile, rows }, { shouldStop = () => false } = {}) {
  const files = releasedFiles({ indexes, perFile });
  const written = new Map();
  for (const f of files) {
    if (shouldStop()) return { ok: true, stopped: true, files: [...written.values()], rows };
    try {
      written.set(f.fileId, await writeOne(root, f.path, f.data));
    } catch {
      return { ok: false, code: 'output.folderFailed', files: [...written.values()], rows: fillOutputs(rows, indexes, written) };
    }
  }
  const filled = fillOutputs(rows, indexes, written);
  try {
    await writeOne(root, 'report.csv', reportCsvBytes(filled));
  } catch {
    return { ok: false, code: 'output.folderFailed', files: [...written.values()], rows: filled };
  }
  return { ok: true, folder: true, name: root.name, files: [...written.values()], rows: filled, recipe: plan.recipe.recipe };
}
