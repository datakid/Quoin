import { outlineModule } from './outline.js';

function physicalStatements(text) {
  const lines = text.split(/\r\n|\r|\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    let startLine = i + 1;
    let joined = '';
    for (;;) {
      let inStr = false;
      let cut = line.length;
      for (let k = 0; k < line.length; k++) {
        const c = line[k];
        if (c === '"') {
          if (inStr && line[k + 1] === '"') k++;
          else inStr = !inStr;
        } else if (c === "'" && !inStr) {
          cut = k;
          break;
        }
      }
      const code = line.slice(0, cut);
      const cont = cut === line.length && /\s_\s*$/.test(code) && i + 1 < lines.length;
      joined += cont ? code.replace(/\s_\s*$/, ' ') : code;
      if (!cont) break;
      i++;
      line = lines[i];
    }
    for (const part of splitColons(joined)) out.push({ text: part, line: startLine });
  }
  return out;
}

function splitColons(code) {
  const parts = [];
  let cur = '';
  let inStr = false;
  let depth = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '"') {
      if (inStr && code[i + 1] === '"') {
        cur += '""';
        i++;
        continue;
      }
      inStr = !inStr;
    } else if (!inStr) {
      if (c === '(') depth++;
      else if (c === ')') depth = Math.max(0, depth - 1);
      else if (c === ':' && depth === 0 && code[i + 1] !== '=') {
        parts.push(cur);
        cur = '';
        continue;
      }
    }
    cur += c;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const LITERAL = /^\s*"((?:[^"]|"")*)"\s*$/;

function literalOf(arg) {
  const m = LITERAL.exec(arg);
  return m ? m[1].replace(/""/g, '"') : null;
}

function expandWith(stmt, withExpr) {
  if (!withExpr) return stmt;
  return stmt.replace(/(^|[^\w)\]"])\.(?=[A-Za-z_])/g, (all, pre) => `${pre}${withExpr}.`);
}

function connectionQuery(name) {
  return name.replace(/^\s*Query\s*-\s*/i, '');
}

function maskStrings(text) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inStr && text[i + 1] === '"') {
        out += '  ';
        i++;
        continue;
      }
      inStr = !inStr;
      out += '"';
    } else out += inStr ? ' ' : c;
  }
  return out;
}

function* scan(re, text) {
  const masked = maskStrings(text);
  for (const m of masked.matchAll(re)) {
    const slice = text.slice(m.index, m.index + m[0].length);
    const again = new RegExp(re.source, re.flags.replace('g', '')).exec(slice);
    yield { index: m.index, groups: again || m };
  }
}

export function scanProcedureLinks(procText) {
  const links = [];
  const withStack = [];
  for (const st of physicalStatements(procText)) {
    const wm = /^With\s+(.+)$/i.exec(st.text);
    if (wm) {
      withStack.push(expandWith(wm[1], withStack[withStack.length - 1] || ''));
      continue;
    }
    if (/^End\s+With\b/i.test(st.text)) {
      withStack.pop();
      continue;
    }
    const text = expandWith(st.text, withStack[withStack.length - 1] || '');
    const found = [];
    for (const m of scan(/Connections\s*\(([^)]*)\)\s*(?:\.OLEDBConnection\s*)?\.Refresh\b/gi, text)) {
      const lit = literalOf(m.groups[1]);
      found.push({ at: m.index, kind: 'refresh', via: 'connection', name: lit === null ? null : connectionQuery(lit), dynamic: lit === null });
    }
    for (const m of scan(/ListObjects\s*\(([^)]*)\)\s*(?:\.QueryTable\s*)?\.Refresh\b/gi, text)) {
      const lit = literalOf(m.groups[1]);
      found.push({ at: m.index, kind: 'refresh', via: 'table', name: lit, dynamic: lit === null });
    }
    for (const m of scan(/\bQueries\s*\(([^)]*)\)/gi, text)) {
      const lit = literalOf(m.groups[1]);
      found.push({ at: m.index, kind: 'read', via: 'queries', name: lit, dynamic: lit === null });
    }
    for (const m of scan(/\bRefreshAll\b/gi, text)) found.push({ at: m.index, kind: 'all', via: 'all', name: null, dynamic: false });
    found.sort((a, b) => a.at - b.at);
    for (const f of found) links.push({ kind: f.kind, via: f.via, name: f.name, dynamic: f.dynamic, line: st.line });
  }
  return links;
}

export function pqLinksOfModule(text, moduleKind = 'standard') {
  const lines = text.split(/\r\n|\r|\n/);
  const out = new Map();
  for (const p of outlineModule(text, { moduleKind }).procedures) {
    const body = lines.slice(p.bodyStartLine - 1, p.endLine - 1).join('\n');
    const links = scanProcedureLinks(body).map((l) => ({ ...l, line: l.line + p.bodyStartLine - 1 }));
    if (links.length) out.set(p.name, links);
  }
  return out;
}

export function resolveLinks(links, { queries, loaded = null, queryOfTable = () => null }) {
  const known = new Set(queries);
  const all = loaded || queries;
  const resolved = [];
  for (const l of links) {
    if (l.kind === 'all') {
      resolved.push({ ...l, queries: all.slice(), unknown: false });
      continue;
    }
    if (l.dynamic) {
      resolved.push({ ...l, queries: [], unknown: false });
      continue;
    }
    let q = null;
    if (l.via === 'table') q = queryOfTable(l.name);
    else if (l.via === 'connection') q = known.has(l.name) ? l.name : known.has(l.name.replace(/^Query - /i, '')) ? l.name.replace(/^Query - /i, '') : null;
    else q = known.has(l.name) ? l.name : null;
    resolved.push({ ...l, queries: q ? [q] : [], unknown: !q });
  }
  return resolved;
}

export function runPlanOf(resolved) {
  const names = [];
  const dynamic = [];
  const unknown = [];
  for (const l of resolved) {
    if (l.kind === 'read') continue;
    if (l.dynamic) {
      dynamic.push({ line: l.line, via: l.via });
      continue;
    }
    if (l.unknown) {
      unknown.push({ line: l.line, name: l.name });
      continue;
    }
    for (const q of l.queries) if (!names.includes(q)) names.push(q);
  }
  return { names, dynamic, unknown };
}

export function refreshedBy(perModule, ctx) {
  const out = new Map();
  for (const [moduleName, procs] of perModule) {
    for (const [procName, links] of procs) {
      for (const r of resolveLinks(links, ctx)) {
        if (r.kind === 'read') continue;
        for (const q of r.queries) {
          const list = out.get(q) || [];
          const who = `${moduleName}.${procName}`;
          if (!list.includes(who)) list.push(who);
          out.set(q, list);
        }
      }
    }
  }
  return out;
}
