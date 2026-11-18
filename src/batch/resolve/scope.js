const lower = (text) => text.toLowerCase();

const byIndex = (a, b) => a.index - b.index;

const TABLE_REF = /^\$?[A-Za-z]{1,3}\$?(\d+)(?::\$?[A-Za-z]{1,3}\$?(\d+))?$/;

function tableRows(ref) {
  const m = TABLE_REF.exec(String(ref));
  if (!m) return null;
  const first = Number(m[1]);
  const last = m[2] === undefined ? first : Number(m[2]);
  return Math.abs(last - first) + 1;
}

function tableHasRows(table) {
  const rows = tableRows(table.ref);
  return rows === null || rows > Math.max(0, table.headerRowCount || 0);
}

function globRegExp(pattern) {
  let source = '';
  for (const ch of pattern) source += ch === '*' ? '.*' : ch === '?' ? '.' : ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return new RegExp(`^${source}$`, 'isu');
}

export function buildMatcher(scope) {
  if (scope.match !== 'pattern') return { test: () => true, error: null };
  try {
    const re = scope.patternKind === 'regex' ? new RegExp(scope.pattern) : globRegExp(scope.pattern);
    return { test: (name) => re.test(name), error: null };
  } catch {
    return { test: () => false, error: { code: 'scope.pattern', detail: scope.pattern } };
  }
}

export function worksheets(index) {
  const out = index.sheets.filter((s) => s.type === 'worksheet');
  for (let i = 1; i < out.length; i++) if (out[i].index < out[i - 1].index) return out.sort(byIndex);
  return out;
}

function sheetState(index) {
  const states = new Map();
  for (const s of index.sheets) states.set(s.name, s.state);
  return states;
}

function sheetCandidates(sheets, scope) {
  const out = [];
  for (const s of sheets) {
    if (scope.excludeHidden && s.state !== 'visible') continue;
    if (scope.onlyNonEmpty && s.nonEmpty === false) continue;
    out.push({ name: s.name, kind: 'sheet' });
  }
  return out;
}

function orderedTables(index) {
  const position = new Map();
  for (const s of index.sheets) position.set(s.name, s.index);
  return index.tables
    .map((t, order) => ({ t, order, at: position.has(t.sheet) ? position.get(t.sheet) : Infinity }))
    .sort((a, b) => (a.at === b.at ? a.order - b.order : a.at < b.at ? -1 : 1))
    .map((x) => x.t);
}

function tableCandidates(index, scope) {
  const states = sheetState(index);
  const out = [];
  for (const t of orderedTables(index)) {
    if (scope.excludeHidden && states.has(t.sheet) && states.get(t.sheet) !== 'visible') continue;
    if (scope.onlyWithHeader && !(t.headerRowCount >= 1)) continue;
    if (scope.onlyNonEmpty && !tableHasRows(t)) continue;
    out.push({ name: t.name, kind: 'table' });
  }
  return out;
}

function byPosition(candidates, position) {
  switch (position.kind) {
    case 'first':
      return candidates.slice(0, 1);
    case 'last':
      return candidates.slice(-1);
    case 'index':
      return candidates.slice(position.index - 1, position.index);
    default:
      return candidates.slice(position.from - 1, position.to);
  }
}

function toUnits(index, picked) {
  return picked.map((c, i) => ({ fileId: index.id, kind: c.kind, name: c.name, index: i + 1 }));
}

export function ruleUnits(index, scope, matcher, sheets = worksheets(index)) {
  const candidates = scope.type === 'tables' ? tableCandidates(index, scope) : sheetCandidates(sheets, scope);
  let picked = candidates;
  if (scope.match === 'pattern') picked = candidates.filter((c) => matcher.test(c.name));
  else if (scope.match === 'position') picked = byPosition(candidates, scope.position);
  if (scope.exclude && scope.exclude.length) {
    const excluded = new Set(scope.exclude.map(lower));
    picked = picked.filter((c) => !excluded.has(lower(c.name)));
  }
  return toUnits(index, picked);
}

export function pinnedUnits(index, scope, names, sheets = worksheets(index)) {
  const wanted = new Map();
  for (const n of names) wanted.set(lower(n), n);
  const pool = scope.type === 'tables' ? orderedTables(index).map((t) => ({ name: t.name, kind: 'table' })) : sheets.map((s) => ({ name: s.name, kind: 'sheet' }));
  const picked = pool.filter((c) => wanted.has(lower(c.name)));
  const found = new Set(picked.map((c) => lower(c.name)));
  const missing = names.filter((n, i) => !found.has(lower(n)) && names.findIndex((m) => lower(m) === lower(n)) === i);
  return { units: toUnits(index, picked), missing };
}

export function matchPins(overrides, files) {
  const byName = new Map();
  const byPath = new Map();
  const add = (map, key, file) => {
    if (map.has(key)) map.get(key).push(file);
    else map.set(key, [file]);
  };
  for (const f of files) {
    add(byName, f.name, f);
    add(byPath, f.relPath, f);
  }
  const matched = new Map();
  const orphans = [];
  for (const pin of overrides) {
    let hits = byName.get(pin.file) || [];
    if (hits.length > 1) hits = hits.filter((f) => f.relPath === pin.path);
    else if (hits.length === 0) hits = byPath.get(pin.path) || [];
    if (!hits.length) {
      orphans.push({ file: pin.path, units: [...pin.units] });
      continue;
    }
    for (const f of hits) matched.set(f.id, pin);
  }
  return { matched, orphans };
}

export function unknownNonEmpty(index, scope, sheets = worksheets(index)) {
  if (scope.type !== 'sheets' || !scope.onlyNonEmpty) return false;
  return sheets.some((s) => (!scope.excludeHidden || s.state === 'visible') && s.nonEmpty === null);
}

export function inspectNeeds(recipe, indexes) {
  if (recipe.recipe !== 'transform') return [];
  const out = [];
  for (const ix of indexes) if (ix.status === 'ready' && unknownNonEmpty(ix, recipe.scope)) out.push(ix.id);
  return out;
}
