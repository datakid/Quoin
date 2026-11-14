import { splitSection } from '../pq/section.js';
import { parseExpressionText } from '../m/parser.js';

const BINDABLE = { 'File.Contents': 'file', 'Web.Contents': 'web' };
const OTHER = {
  'Folder.Files': 'folder',
  'Folder.Contents': 'folder',
  'Sql.Database': 'database',
  'Sql.Databases': 'database',
  'Odbc.DataSource': 'database',
  'Odbc.Query': 'database',
  'OleDb.DataSource': 'database',
  'Oracle.Database': 'database',
  'MySQL.Database': 'database',
  'PostgreSQL.Database': 'database',
  'Teradata.Database': 'database',
  'SharePoint.Files': 'sharepoint',
  'SharePoint.Contents': 'sharepoint',
  'SharePoint.Tables': 'sharepoint',
  'OData.Feed': 'web',
  'Web.Page': 'web',
  'Json.Document': null,
  'Xml.Tables': null
};

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) walk(n, visit);
    return;
  }
  if (node.t) visit(node);
  for (const key of Object.keys(node)) {
    if (key === 't' || key === 'start' || key === 'end') continue;
    const v = node[key];
    if (v && typeof v === 'object') walk(v, visit);
  }
}

export function findSources(ast) {
  const out = [];
  walk(ast, (n) => {
    if (n.t !== 'Invoke' || !n.fn || n.fn.t !== 'Identifier') return;
    const call = n.fn.name;
    const kind = BINDABLE[call] || OTHER[call];
    if (!kind) return;
    const arg = n.args && n.args[0] ? n.args[0] : null;
    const literal = arg && arg.t === 'Literal' && arg.vtype === 'text' ? arg.value : null;
    out.push({ kind, call, key: literal, dynamic: literal === null, bindable: !!BINDABLE[call], start: n.start, end: n.end });
  });
  return out;
}

export function sourcesOfSection(sectionText) {
  const split = splitSection(sectionText);
  const sources = new Map();
  const byQuery = new Map();
  for (const m of split.members) {
    let ast;
    try {
      ast = parseExpressionText(sectionText.slice(m.exprStart, m.exprEnd), m.exprStart, sectionText);
    } catch {
      byQuery.set(m.name, []);
      continue;
    }
    const found = findSources(ast);
    byQuery.set(m.name, found);
    for (const f of found) {
      const id = f.dynamic ? `dynamic:${f.call}` : `${f.kind}:${f.key}`;
      let s = sources.get(id);
      if (!s) {
        s = { id, kind: f.kind, call: f.call, key: f.key, dynamic: f.dynamic, bindable: f.bindable, queries: [] };
        sources.set(id, s);
      }
      if (!s.queries.includes(m.name)) s.queries.push(m.name);
    }
  }
  return { sources, byQuery };
}

export function bindingKeysOf(inventory, name) {
  return (inventory.byQuery.get(name) || []).filter((f) => f.bindable && f.key !== null).map((f) => f.key);
}

export function unbound(inventory, boundKeys) {
  const bound = boundKeys instanceof Set ? boundKeys : new Set(boundKeys);
  return [...inventory.sources.values()].filter((s) => s.bindable && !s.dynamic && !bound.has(s.key));
}
