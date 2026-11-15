import { outlineModule } from './outline.js';

function eolOf(text) {
  return /\r\n/.test(text) ? '\r\n' : /\r/.test(text) && !/\n/.test(text) ? '\r' : '\n';
}

function splitLines(text) {
  return text.split(/\r\n|\r|\n/);
}

const norm = (lines) => lines.map((l) => l.replace(/[ \t]+$/, '')).join('\n');

function indexOf(text, moduleKind) {
  const lines = splitLines(text);
  const o = outlineModule(text, { moduleKind });
  const seen = new Map();
  const procs = o.procedures.map((p) => {
    const base = `${p.kind}:${p.name.toLowerCase()}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return { key: n > 1 ? `${base}#${n}` : base, name: p.name, kind: p.kind, startLine: p.startLine, endLine: p.endLine, lines: lines.slice(p.startLine - 1, p.endLine) };
  });
  return { lines, procs, eol: eolOf(text) };
}

export function matchProcedures(originalText, currentText, moduleKind = 'standard') {
  const orig = indexOf(originalText, moduleKind);
  const cur = indexOf(currentText, moduleKind);
  const byKey = new Map(orig.procs.map((p) => [p.key, p]));
  const rows = cur.procs.map((p) => {
    const o = byKey.get(p.key);
    const status = !o ? 'added' : norm(o.lines) === norm(p.lines) ? 'same' : 'edited';
    return { key: p.key, name: p.name, kind: p.kind, startLine: p.startLine, endLine: p.endLine, status };
  });
  const present = new Set(cur.procs.map((p) => p.key));
  const removed = orig.procs.filter((p) => !present.has(p.key)).map((p) => ({ key: p.key, name: p.name, kind: p.kind, startLine: p.startLine, endLine: p.endLine, status: 'removed' }));
  return { rows, removed };
}

export function revertProcedure(originalText, currentText, key, moduleKind = 'standard') {
  const orig = indexOf(originalText, moduleKind);
  const cur = indexOf(currentText, moduleKind);
  const o = orig.procs.find((p) => p.key === key);
  const c = cur.procs.find((p) => p.key === key);
  const eol = cur.eol;
  if (c && o) {
    const lines = [...cur.lines.slice(0, c.startLine - 1), ...o.lines, ...cur.lines.slice(c.endLine)];
    return { ok: true, text: lines.join(eol) };
  }
  if (c && !o) {
    let from = c.startLine - 1;
    let to = c.endLine;
    if (to >= cur.lines.length) {
      while (from > 0 && cur.lines[from - 1].trim() === '') from--;
    } else {
      while (to < cur.lines.length && cur.lines[to].trim() === '' && from > 0 && cur.lines[from - 1].trim() === '') to++;
    }
    const lines = [...cur.lines.slice(0, from), ...cur.lines.slice(to)];
    return { ok: true, text: lines.join(eol) };
  }
  if (!c && o) {
    const idx = orig.procs.findIndex((p) => p.key === key);
    const before = orig.procs.slice(0, idx).reverse().find((p) => cur.procs.some((x) => x.key === p.key));
    const anchor = before ? cur.procs.find((x) => x.key === before.key).endLine : cur.lines.length;
    const lines = [...cur.lines.slice(0, anchor), '', ...o.lines, ...cur.lines.slice(anchor)];
    return { ok: true, text: lines.join(eol) };
  }
  return { ok: false, reason: 'That procedure does not exist.' };
}
