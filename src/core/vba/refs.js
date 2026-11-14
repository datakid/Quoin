import { outlineModule, logicalLines } from './outline.js';

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/g;
const RUN = /Application\s*\.\s*Run\s*\(?\s*"((?:[^"]|"")*)"/gi;

function stripComment(line) {
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inStr && line[i + 1] === '"') i++;
      else inStr = !inStr;
    } else if (c === "'" && !inStr) return line.slice(0, i);
  }
  return line;
}

function localsOf(masked, params) {
  const out = new Set(params.map((p) => p.name.toLowerCase()));
  for (const m of masked.matchAll(/\b(?:Dim|Static|Const|ReDim)\s+([^:]+)/gi)) {
    for (const part of m[1].split(',')) {
      const n = /^\s*(?:Preserve\s+)?([A-Za-z_]\w*)/i.exec(part);
      if (n) out.add(n[1].toLowerCase());
    }
  }
  return out;
}

export function analyseCalls(modules) {
  const procs = new Map();
  const byName = new Map();
  const outlines = new Map();
  for (const m of modules) {
    const kind = m.kind === 'standard' || m.kind === 'class' ? m.kind : 'document';
    const o = outlineModule(m.text, { moduleKind: kind });
    outlines.set(m.name, o);
    for (const p of o.procedures) {
      const key = `${m.name}.${p.name}`;
      const existing = procs.get(key);
      if (existing) {
        existing.kinds.push(p.kind);
        existing.ranges.push([p.startLine, p.endLine]);
        continue;
      }
      const proc = { key, module: m.name, name: p.name, kinds: [p.kind], scope: p.scope, startLine: p.startLine, endLine: p.endLine, ranges: [[p.startLine, p.endLine]], isEntryPoint: p.isEntryPoint, isEventHandler: p.isEventHandler, params: p.params };
      procs.set(key, proc);
      const lower = p.name.toLowerCase();
      if (!byName.has(lower)) byName.set(lower, []);
      byName.get(lower).push(proc);
    }
  }
  const moduleNames = new Map(modules.map((m) => [m.name.toLowerCase(), m.name]));
  const visible = (name, fromModule) => (byName.get(name.toLowerCase()) || []).filter((p) => p.module === fromModule || (p.scope !== 'private' && !(outlines.get(p.module).options.private)));
  const calls = new Map([...procs.keys()].map((k) => [k, new Set()]));
  const calledBy = new Map([...procs.keys()].map((k) => [k, new Set()]));
  const refs = new Map([...procs.keys()].map((k) => [k, []]));
  const link = (from, to, line, col) => {
    if (from.key === to.key) return;
    calls.get(from.key).add(to.key);
    calledBy.get(to.key).add(from.key);
    refs.get(to.key).push({ module: from.module, line, col, from: from.key });
  };
  for (const m of modules) {
    const { lines } = logicalLines(m.text);
    const raw = m.text.split(/\r\n|\r|\n/);
    const o = outlines.get(m.name);
    for (const proc of o.procedures) {
      const self = procs.get(`${m.name}.${proc.name}`);
      const bodyLines = lines.filter((l) => l.line >= proc.bodyStartLine && l.line < proc.endLine);
      const masked = bodyLines.map((l) => l.text).join('\n');
      const locals = localsOf(masked, proc.params);
      locals.add(proc.name.toLowerCase());
      for (const L of bodyLines) {
        const text = L.text;
        for (const t of text.matchAll(IDENT)) {
          const at = t.index;
          const name = t[0];
          const before = text.slice(0, at).trimEnd();
          if (before.endsWith('.')) continue;
          const after = text.slice(at + name.length);
          const q = /^\s*\.\s*([A-Za-z_]\w*)/.exec(after);
          if (q && moduleNames.has(name.toLowerCase())) {
            const mod = moduleNames.get(name.toLowerCase());
            const target = procs.get(`${mod}.${q[1]}`) || (byName.get(q[1].toLowerCase()) || []).find((p) => p.module === mod);
            if (target && (target.scope !== 'private' || mod === m.name)) link(self, target, L.line, L.col + at);
            continue;
          }
          if (locals.has(name.toLowerCase())) continue;
          for (const target of visible(name, m.name)) link(self, target, L.line, L.col + at);
        }
      }
      for (let ln = proc.bodyStartLine; ln < proc.endLine; ln++) {
        const line = stripComment(raw[ln - 1] || '');
        for (const r of line.matchAll(RUN)) {
          const spec = r[1].replace(/""/g, '"').split('!').pop();
          const dot = spec.lastIndexOf('.');
          const mod = dot >= 0 ? spec.slice(0, dot) : null;
          const name = dot >= 0 ? spec.slice(dot + 1) : spec;
          const targets = (byName.get(name.toLowerCase()) || []).filter((p) => (mod === null ? true : p.module.toLowerCase() === mod.toLowerCase()) && (p.scope !== 'private' || p.module === m.name));
          for (const target of targets) link(self, target, ln, (r.index || 0) + 1);
        }
      }
    }
  }
  const noCallers = [...procs.values()].filter((p) => !calledBy.get(p.key).size && !p.isEventHandler).map((p) => p.key);
  return { procs, calls, calledBy, refs, noCallers };
}

export function definitionOf(graph, name, fromModule) {
  const all = [...graph.procs.values()].filter((p) => p.name.toLowerCase() === name.toLowerCase());
  return all.find((p) => p.module === fromModule) || all.find((p) => p.scope !== 'private') || null;
}
