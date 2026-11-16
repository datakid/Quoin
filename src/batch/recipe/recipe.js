export const RECIPE_VERSION = 1;
export const RECIPE_KINDS = ['collect', 'inject', 'replace', 'transform', 'align'];
export const TOKENS = ['{file.name}', '{file.folder}', '{unit.name}', '{unit.index}'];

const MAX_TEXT = 1024 * 1024;
const BLOCK_KINDS = { inject: 'inject', replace: 'replace', transform: 'query', align: 'align' };
const SHA256_HEX = /^[0-9a-f]{64}$/;

class Invalid extends Error {}

const fail = (path, message) => {
  throw new Invalid(`${path}: ${message}`);
};

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.length > 0;
const isCount = (v) => Number.isInteger(v) && v >= 1;

function oneOf(path, value, allowed) {
  if (!allowed.includes(value)) fail(path, `must be one of ${allowed.join(', ')}`);
  return value;
}

function bool(path, value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') fail(path, 'must be true or false');
  return value;
}

function text(path, value) {
  if (!isText(value)) fail(path, 'must be a non-empty string');
  return value;
}

function strings(path, value) {
  if (!Array.isArray(value) || value.some((x) => typeof x !== 'string')) fail(path, 'must be a list of strings');
  return [...value];
}

function checkRegex(path, source) {
  try {
    new RegExp(source);
  } catch {
    fail(path, 'is not a valid regular expression');
  }
}

function known(path, obj, allowed, warnings) {
  for (const key of Object.keys(obj)) if (!allowed.includes(key)) warnings.push({ code: 'recipe.unknownField', path: path ? `${path}.${key}` : key });
}

function normaliseScope(raw, warnings) {
  if (raw === undefined) return { type: 'workbook', match: 'all', excludeHidden: true };
  if (!isObject(raw)) fail('scope', 'must be an object');
  known('scope', raw, ['type', 'match', 'pattern', 'patternKind', 'position', 'onlyNonEmpty', 'onlyWithHeader', 'excludeHidden', 'exclude'], warnings);
  const out = { type: oneOf('scope.type', raw.type, ['workbook', 'sheets', 'tables']), match: oneOf('scope.match', raw.match === undefined ? 'all' : raw.match, ['all', 'pattern', 'position']) };
  if (out.match === 'pattern') {
    out.pattern = text('scope.pattern', raw.pattern);
    out.patternKind = oneOf('scope.patternKind', raw.patternKind === undefined ? 'glob' : raw.patternKind, ['glob', 'regex']);
    if (out.patternKind === 'regex') checkRegex('scope.pattern', out.pattern);
  }
  if (out.match === 'position') out.position = normalisePosition(raw.position, warnings);
  if (raw.onlyNonEmpty !== undefined) out.onlyNonEmpty = bool('scope.onlyNonEmpty', raw.onlyNonEmpty);
  if (raw.onlyWithHeader !== undefined) out.onlyWithHeader = bool('scope.onlyWithHeader', raw.onlyWithHeader);
  out.excludeHidden = bool('scope.excludeHidden', raw.excludeHidden, true);
  if (raw.exclude !== undefined) out.exclude = strings('scope.exclude', raw.exclude);
  return out;
}

function normalisePosition(raw, warnings) {
  if (!isObject(raw)) fail('scope.position', 'is needed when match is position');
  known('scope.position', raw, ['kind', 'index', 'from', 'to'], warnings);
  const kind = oneOf('scope.position.kind', raw.kind, ['first', 'last', 'index', 'range']);
  if (kind === 'index') {
    if (!isCount(raw.index)) fail('scope.position.index', 'must be a whole number from 1');
    return { kind, index: raw.index };
  }
  if (kind === 'range') {
    if (!isCount(raw.from) || !isCount(raw.to)) fail('scope.position', 'range needs whole numbers from and to, from 1');
    if (raw.from > raw.to) fail('scope.position', 'range must not end before it starts');
    return { kind, from: raw.from, to: raw.to };
  }
  return { kind };
}

function normaliseOverrides(raw, warnings) {
  if (!Array.isArray(raw)) fail('overrides', 'must be a list');
  return raw.map((o, i) => {
    const at = `overrides[${i}]`;
    if (!isObject(o)) fail(at, 'must be an object');
    known(at, o, ['file', 'path', 'units'], warnings);
    return { file: text(`${at}.file`, o.file), path: text(`${at}.path`, o.path), units: strings(`${at}.units`, o.units) };
  });
}

function normaliseInject(raw, warnings) {
  if (!isObject(raw)) fail('inject', 'must be an object');
  known('inject', raw, ['target', 'op', 'match', 'name', 'newName', 'source', 'text', 'refreshOnLoad'], warnings);
  const out = {
    target: oneOf('inject.target', raw.target, ['query', 'module']),
    op: oneOf('inject.op', raw.op, ['add', 'replace', 'rename', 'remove']),
    match: oneOf('inject.match', raw.match === undefined ? 'name' : raw.match, ['name', 'pattern']),
    name: text('inject.name', raw.name),
    newName: null,
    source: oneOf('inject.source', raw.source === undefined ? 'inline' : raw.source, ['inline'])
  };
  if (out.op === 'rename') out.newName = text('inject.newName', raw.newName);
  else if (raw.newName !== undefined && raw.newName !== null) out.newName = text('inject.newName', raw.newName);
  if (out.op === 'add' || out.op === 'replace') out.text = text('inject.text', raw.text);
  else if (raw.text !== undefined) out.text = typeof raw.text === 'string' ? raw.text : fail('inject.text', 'must be a string');
  if (raw.refreshOnLoad !== undefined) out.refreshOnLoad = bool('inject.refreshOnLoad', raw.refreshOnLoad);
  return out;
}

function normaliseReplace(raw, warnings) {
  if (!isObject(raw)) fail('replace', 'must be an object');
  known('replace', raw, ['in', 'find', 'with', 'kind', 'matchCase'], warnings);
  const where = strings('replace.in', raw.in);
  if (!where.length || where.some((w) => !['m', 'vba'].includes(w))) fail('replace.in', 'must list m, vba or both');
  const out = { in: where, find: text('replace.find', raw.find) };
  if (typeof raw.with !== 'string') fail('replace.with', 'must be a string');
  out.with = raw.with;
  out.kind = oneOf('replace.kind', raw.kind === undefined ? 'text' : raw.kind, ['text', 'regex']);
  if (out.kind === 'regex') checkRegex('replace.find', out.find);
  out.matchCase = bool('replace.matchCase', raw.matchCase, true);
  return out;
}

function normaliseQuery(raw, warnings) {
  if (!isObject(raw)) fail('query', 'must be an object');
  known('query', raw, ['source', 'm'], warnings);
  return { source: oneOf('query.source', raw.source === undefined ? 'inline' : raw.source, ['inline']), m: text('query.m', raw.m) };
}

function normaliseAlign(raw, warnings) {
  if (!isObject(raw)) fail('align', 'must be an object');
  known('align', raw, ['target', 'name', 'hash'], warnings);
  const hash = text('align.hash', raw.hash);
  if (!SHA256_HEX.test(hash)) fail('align.hash', 'must be a full lower case SHA-256');
  return { target: oneOf('align.target', raw.target, ['query', 'module']), name: text('align.name', raw.name), hash };
}

function normaliseOutput(raw, warnings) {
  if (!isObject(raw)) fail('output', 'must be an object');
  known('output', raw, ['mode', 'name', 'range'], warnings);
  const out = { mode: oneOf('output.mode', raw.mode, ['newFile', 'newSheet', 'combined', 'inPlace']) };
  if (raw.name !== undefined) out.name = typeof raw.name === 'string' ? raw.name : fail('output.name', 'must be a string');
  if (raw.range !== undefined) out.range = raw.range === null || typeof raw.range === 'string' ? raw.range : fail('output.range', 'must be text or null');
  return out;
}

function normaliseMore(raw, warnings) {
  const src = raw === undefined ? {} : raw;
  if (!isObject(src)) fail('more', 'must be an object');
  known('more', src, ['culture', 'limits', 'encoding', 'csvGuard'], warnings);
  const limits = src.limits === undefined ? {} : src.limits;
  if (!isObject(limits)) fail('more.limits', 'must be an object');
  known('more.limits', limits, ['timeoutMs', 'maxRows'], warnings);
  const count = (key, fallback) => {
    if (limits[key] === undefined) return fallback;
    if (!isCount(limits[key])) fail(`more.limits.${key}`, 'must be a whole number from 1');
    return limits[key];
  };
  return {
    culture: src.culture === undefined ? 'en-US' : text('more.culture', src.culture),
    limits: { timeoutMs: count('timeoutMs', 30000), maxRows: count('maxRows', 1000000) },
    encoding: oneOf('more.encoding', src.encoding === undefined ? 'utf-8' : src.encoding, ['utf-8']),
    csvGuard: bool('more.csvGuard', src.csvGuard, true)
  };
}

const NORMALISERS = { inject: normaliseInject, replace: normaliseReplace, query: normaliseQuery, align: normaliseAlign };

function normalise(raw) {
  const warnings = [];
  const kind = oneOf('recipe', raw.recipe, RECIPE_KINDS);
  const own = BLOCK_KINDS[kind];
  const out = { recipe: kind, v: RECIPE_VERSION };
  const allowed = ['recipe', 'v', 'name', 'scope', 'overrides', 'inject', 'replace', 'query', 'align', 'output', 'compute', 'more'];
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) warnings.push({ code: 'recipe.unknownField', path: key });
    else if (Object.values(BLOCK_KINDS).includes(key) && key !== own) warnings.push({ code: 'recipe.ignored', path: key });
  }
  if (raw.name !== undefined) out.name = typeof raw.name === 'string' ? raw.name : fail('name', 'must be a string');
  out.scope = normaliseScope(raw.scope, warnings);
  if (raw.overrides !== undefined) out.overrides = normaliseOverrides(raw.overrides, warnings);
  if (own) {
    if (raw[own] === undefined) fail(own, `a ${kind} recipe needs an "${own}" block`);
    out[own] = NORMALISERS[own](raw[own], warnings);
  }
  if (raw.output !== undefined) out.output = normaliseOutput(raw.output, warnings);
  out.compute = oneOf('compute', raw.compute === undefined ? 'quoin' : raw.compute, ['quoin', 'excel']);
  out.more = normaliseMore(raw.more, warnings);
  return { recipe: out, warnings };
}

export function parseRecipe(source) {
  if (typeof source !== 'string') return { ok: false, code: 'recipe.invalid', detail: 'recipe text must be a string' };
  if (source.length > MAX_TEXT) return { ok: false, code: 'recipe.invalid', detail: 'recipe text is too large' };
  let raw;
  try {
    raw = JSON.parse(source);
  } catch {
    return { ok: false, code: 'recipe.invalid', detail: 'not valid JSON' };
  }
  if (!isObject(raw)) return { ok: false, code: 'recipe.invalid', detail: 'a recipe must be a JSON object' };
  if (typeof raw.v === 'number' && Number.isInteger(raw.v) && raw.v > RECIPE_VERSION) return { ok: false, code: 'recipe.newer', detail: `version ${raw.v}` };
  try {
    if (!isCount(raw.v)) fail('v', 'must be a whole number from 1');
    return { ok: true, ...normalise(raw) };
  } catch (e) {
    if (!(e instanceof Invalid)) throw e;
    return { ok: false, code: 'recipe.invalid', detail: e.message };
  }
}

export function serialiseRecipe(recipe) {
  const parsed = parseRecipe(JSON.stringify(recipe));
  if (!parsed.ok) throw new Error(`cannot serialise an invalid recipe: ${parsed.detail}`);
  return `${JSON.stringify(parsed.recipe, null, 2)}\n`;
}

export function unknownTokens(template) {
  const found = [];
  for (const token of String(template).match(/\{[^{}]*\}/g) || []) if (!TOKENS.includes(token) && !found.includes(token)) found.push(token);
  return found;
}
