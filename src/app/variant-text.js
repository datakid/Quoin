import { applyMessage } from '../batch/protocol.js';
import { parseRecipe } from '../batch/recipe/recipe.js';
import { resolvePlan } from '../batch/resolve/resolve.js';
import { Package } from '../core/opc.js';
import { readZip } from '../core/zip-read.js';

export function createVariantTextLoader({ pool, session, now, runId }) {
  const recipe = parseRecipe(JSON.stringify({ recipe: 'collect', v: 1 })).recipe;
  const cache = new Map();

  async function read(item, version) {
    const rec = session.file(version.files[0].fileId);
    const filePlan = resolvePlan(recipe, [rec.index], { now }).files[0];
    const fileRef = { id: rec.id, name: rec.name, relPath: rec.relPath, size: rec.size, lastModified: rec.lastModified, file: rec.file };
    const reply = await pool.submit({ message: applyMessage(fileRef, filePlan, { now, dryRun: false, limits: recipe.more.limits, culture: recipe.more.culture, runId }), estimate: rec.size });
    if (reply.status !== 'done' || reply.message.type !== 'applied' || !reply.message.result.bytes) throw new Error('variant.read');
    const at = filePlan.actions.findIndex((a) => a.target.type === item.kind && a.target.name === item.name);
    const output = at < 0 ? '' : reply.message.result.rows[at].output;
    if (!output) throw new Error('variant.read');
    const entry = await new Package(readZip(reply.message.result.bytes)).bytes(output);
    return new TextDecoder().decode(entry);
  }

  return (item, version) => {
    const key = `${item.kind}:${item.name}:${version.hash}`;
    if (!cache.has(key)) {
      const pending = read(item, version);
      cache.set(key, pending);
      pending.catch(() => cache.delete(key));
    }
    return cache.get(key);
  };
}
