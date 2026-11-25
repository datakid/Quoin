import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';

const root = join(fileURLToPath(import.meta.url), '..', '..', '..');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git' || name === 'external' || name === 'workbooks' || name === 'expected') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const rel = (p) => relative(root, p).split('\\').join('/');
const read = (p) => readFileSync(p, 'utf8');
const all = walk(root).filter((p) => !rel(p).startsWith('package-lock') && !rel(p).startsWith('scratch/') && !rel(p).startsWith('docs/') && !rel(p).startsWith('public/fonts/'));
const jsFiles = all.filter((p) => ['.js', '.mjs'].includes(extname(p)));
const shipped = (p) => /^(index\.html|sw\.js|src\/|styles\/|manifest\.webmanifest|public\/[^/]+\.svg)/.test(rel(p));
const srcJs = jsFiles.filter((p) => rel(p).startsWith('src/') || rel(p) === 'sw.js');

function parseSource(text) {
  const comments = [];
  const ast = parse(text, { ecmaVersion: 'latest', sourceType: 'module', locations: true, onComment: comments, allowHashBang: true });
  return { ast, comments };
}

function parseJs(file) {
  return parseSource(read(file));
}

const realComments = (text, comments) => comments.filter((c) => !(c.start === 0 && text.startsWith('#!')));

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

function markerLines(text, marker) {
  const out = [];
  let i = text.indexOf(marker);
  while (i >= 0) {
    out.push(lineOf(text, i));
    i = text.indexOf(marker, i + marker.length);
  }
  return out;
}

function hashCommentLines(text, { quotes }) {
  const out = [];
  text.split('\n').forEach((line, n) => {
    let quote = null;
    for (let k = 0; k < line.length; k++) {
      const ch = line[k];
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (quotes && (ch === '"' || ch === "'")) {
        quote = ch;
        continue;
      }
      if (ch === '#' && (k === 0 || /\s/.test(line[k - 1]))) {
        out.push(n + 1);
        break;
      }
    }
  });
  return out;
}

export const COMMENT_CHECKED = ['.js', '.mjs', '.css', '.html', '.svg', '.yml', '.yaml'];

export function isCommentChecked(relPath) {
  return COMMENT_CHECKED.includes(extname(relPath)) || relPath.split('/').pop() === '_headers';
}

export function commentFindings(relPath, text) {
  const ext = extname(relPath);
  const msg = 'comment';
  if (ext === '.js' || ext === '.mjs') return realComments(text, parseSource(text).comments).map((c) => ({ line: c.loc.start.line, msg }));
  if (ext === '.css') return markerLines(text, '/*').map((line) => ({ line, msg }));
  if (ext === '.html' || ext === '.svg') return markerLines(text, '<!--').map((line) => ({ line, msg }));
  if (ext === '.yml' || ext === '.yaml') return hashCommentLines(text, { quotes: true }).map((line) => ({ line, msg }));
  if (relPath.split('/').pop() === '_headers') return text.split('\n').flatMap((l, n) => (l.trimStart().startsWith('#') ? [{ line: n + 1, msg }] : []));
  return [];
}

function visit(node, fn, parent = null) {
  if (!node || typeof node.type !== 'string') return;
  fn(node, parent);
  for (const key of Object.keys(node)) {
    const v = node[key];
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && visit(c, fn, node));
    else if (v && typeof v.type === 'string') visit(v, fn, node);
  }
}

function visitWithAncestors(node, fn, ancestors = []) {
  if (!node || typeof node.type !== 'string') return;
  fn(node, ancestors);
  const next = [...ancestors, node];
  for (const key of Object.keys(node)) {
    const v = node[key];
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && visitWithAncestors(c, fn, next));
    else if (v && typeof v.type === 'string') visitWithAncestors(v, fn, next);
  }
}

function containsThrow(node) {
  let found = false;
  visit(node, (n) => {
    if (n.type === 'ThrowStatement') found = true;
  });
  return found;
}

const LAYER_GLOBALS = ['document', 'window', 'navigator', 'localStorage', 'self', 'postMessage', 'Worker'];
const BASE64_NAMES = ['btoa', 'atob', 'base64Encode', 'base64Decode'];
const LAYER_TARGETS = {
  core: ['core'],
  batch: ['core', 'batch'],
  workers: ['core', 'batch', 'workers'],
  app: ['core', 'batch', 'workers', 'app', 'ui'],
  ui: ['ui', 'core']
};
const UI_EDGE_ALLOWED = new Set(['src/ui/wb/steps-panel.js -> src/app/commands.js']);
const layerOf = (p) => {
  const m = /^src\/([^/]+)\//.exec(p);
  return m ? m[1] : null;
};

function identifierRefs(text, names, { members }) {
  const out = [];
  visit(parseSource(text).ast, (n, parent) => {
    if (n.type === 'Identifier' && names.includes(n.name)) {
      const asProperty = parent && parent.type === 'MemberExpression' && parent.property === n && !parent.computed;
      const asKey = parent && ['Property', 'MethodDefinition', 'PropertyDefinition'].includes(parent.type) && parent.key === n && !parent.computed;
      if (asKey || (asProperty && !members)) return;
      out.push({ line: n.loc.start.line, msg: n.name });
    }
  });
  return out;
}

export const STORAGE_KEYS = ['quoin.theme', 'quoin.recipes', 'quoin.recent'];

export function storageFindings(relPath, text) {
  const out = [];
  const add = (line, msg) => out.push({ line, msg });
  visit(parseSource(text).ast, (n, parent) => {
    if (n.type === 'Identifier' && n.name === 'localStorage') {
      const call = parent && parent.type === 'MemberExpression' ? parent : null;
      if (!call) add(n.loc.start.line, 'localStorage');
    }
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && ['getItem', 'setItem', 'removeItem'].includes(n.callee.property.name) && n.callee.object.type === 'MemberExpression' && n.callee.object.property.name === 'localStorage') {
      const a = n.arguments[0];
      if (!a || a.type !== 'Literal' || !STORAGE_KEYS.includes(a.value)) add(n.loc.start.line, 'localStorage key');
    }
    if (n.type === 'MemberExpression' && n.property.name === 'sessionStorage') add(n.loc.start.line, 'sessionStorage');
    if (n.type === 'Identifier' && ['sessionStorage', 'indexedDB'].includes(n.name)) add(n.loc.start.line, n.name);
  });
  return out;
}

export function layerPurityFindings(relPath, text) {
  if (!relPath.startsWith('src/batch/')) return [];
  return identifierRefs(text, LAYER_GLOBALS, { members: false });
}

export function base64Findings(relPath, text) {
  if (relPath.startsWith('src/core/') || !(relPath.startsWith('src/') || relPath === 'sw.js')) return [];
  return identifierRefs(text, BASE64_NAMES, { members: true });
}

export function importDirectionFindings(relPath, text) {
  const from = layerOf(relPath);
  if (!from || !LAYER_TARGETS[from]) return [];
  const out = [];
  const check = (spec, line) => {
    if (typeof spec !== 'string' || !spec.startsWith('.')) return;
    const target = posix.normalize(posix.join(posix.dirname(relPath), spec));
    const to = layerOf(target);
    if (!to) return;
    if (!LAYER_TARGETS[from].includes(to)) {
      if (!UI_EDGE_ALLOWED.has(`${relPath} -> ${target}`)) out.push({ line, msg: `src/${from} -> src/${to}` });
      return;
    }
    const sub = relPath.startsWith('src/batch/resolve/') ? /^src\/batch\/(execute|verify)\//.exec(target) : null;
    if (sub) out.push({ line, msg: `src/batch/resolve -> src/batch/${sub[1]}` });
  };
  visit(parseSource(text).ast, (n) => {
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(n.type) && n.source) check(n.source.value, n.loc.start.line);
    if (n.type === 'ImportExpression' && n.source.type === 'Literal') check(n.source.value, n.loc.start.line);
  });
  return out;
}

function cssBlock(text, marker) {
  const at = text.indexOf(marker);
  if (at < 0) return '';
  const open = text.indexOf('{', at);
  let depth = 0;
  for (let k = open; k < text.length; k++) {
    if (text[k] === '{') depth++;
    if (text[k] === '}') {
      depth--;
      if (depth === 0) return text.slice(open + 1, k);
    }
  }
  return '';
}

const cssToken = (block, name) => {
  const m = new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{3,8})\\s*;`).exec(block);
  return m ? m[1].toUpperCase() : null;
};

export function runAll() {
  const findings = [];
  const add = (rule, file, line, msg) => findings.push({ rule, file: rel(file), line, msg });
  const parsed = new Map();
  for (const f of jsFiles) {
    try {
      parsed.set(f, parseJs(f));
    } catch (e) {
      add('parse', f, e.loc ? e.loc.line : 0, e.message);
    }
  }

  for (const [f, { comments }] of parsed) for (const c of realComments(read(f), comments)) add('T-LINT-1', f, c.loc.start.line, 'comment');
  for (const f of all.filter((p) => !['.js', '.mjs'].includes(extname(p)) && isCommentChecked(rel(p)))) {
    for (const c of commentFindings(rel(f), read(f))) add('T-LINT-1', f, c.line, c.msg);
  }
  for (const f of all.filter((p) => extname(p) === '.webmanifest')) {
    try {
      JSON.parse(read(f));
    } catch {
      add('T-LINT-1', f, 0, 'manifest is not valid JSON');
    }
  }

  for (const f of srcJs) {
    if (!parsed.has(f)) continue;
    const text = read(f);
    for (const x of layerPurityFindings(rel(f), text)) add('T-LINT-18', f, x.line, x.msg);
    for (const x of importDirectionFindings(rel(f), text)) add('T-LINT-19', f, x.line, x.msg);
    for (const x of base64Findings(rel(f), text)) add('T-LINT-20', f, x.line, x.msg);
    for (const x of storageFindings(rel(f), text)) add('T-LINT-8', f, x.line, x.msg);
  }

  for (const f of srcJs) {
    const entry = parsed.get(f);
    if (!entry) continue;
    visit(entry.ast, (n) => {
      if ((n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration') && n.source) {
        const s = n.source.value;
        if (!s.startsWith('./') && !s.startsWith('../')) add('T-LINT-2', f, n.loc.start.line, `import ${s}`);
      }
      if (n.type === 'ImportExpression' && n.source.type === 'Literal') {
        const s = n.source.value;
        if (!s.startsWith('./') && !s.startsWith('../')) add('T-LINT-2', f, n.loc.start.line, `import ${s}`);
      }
    });
  }

  for (const f of srcJs) {
    const entry = parsed.get(f);
    if (!entry) continue;
    const isSw = rel(f) === 'sw.js';
    visit(entry.ast, (n, parent) => {
      if (n.type === 'Identifier' && ['XMLHttpRequest', 'WebSocket', 'EventSource'].includes(n.name)) add('T-LINT-4', f, n.loc.start.line, n.name);
      if (n.type === 'Identifier' && n.name === 'fetch' && !isSw && !(parent && parent.type === 'MemberExpression' && parent.property === n && !parent.computed)) add('T-LINT-4', f, n.loc.start.line, 'fetch');
      if (n.type === 'Identifier' && n.name === 'sendBeacon') add('T-LINT-4', f, n.loc.start.line, 'sendBeacon');
      if (n.type === 'Identifier' && n.name === 'importScripts') add('T-LINT-4', f, n.loc.start.line, 'importScripts');
      if (n.type === 'MemberExpression' && !n.computed && ['innerHTML', 'outerHTML', 'insertAdjacentHTML'].includes(n.property.name)) add('T-LINT-5', f, n.loc.start.line, n.property.name);
      if (n.type === 'MemberExpression' && !n.computed && n.object.name === 'document' && n.property.name === 'write') add('T-LINT-5', f, n.loc.start.line, 'document.write');
      if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'eval') add('T-LINT-5', f, n.loc.start.line, 'eval');
      if (n.type === 'NewExpression' && n.callee.type === 'Identifier' && n.callee.name === 'Function') add('T-LINT-5', f, n.loc.start.line, 'new Function');
      if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && ['setTimeout', 'setInterval'].includes(n.callee.name) && n.arguments[0] && n.arguments[0].type !== 'ArrowFunctionExpression' && n.arguments[0].type !== 'FunctionExpression' && n.arguments[0].type !== 'Identifier' && n.arguments[0].type !== 'MemberExpression') add('T-LINT-5', f, n.loc.start.line, 'string timer');
      if (rel(f).startsWith('src/core/') && n.type === 'Identifier' && ['document', 'window', 'navigator'].includes(n.name) && !(parent && parent.type === 'MemberExpression' && parent.property === n && !parent.computed) && !(parent && parent.type === 'Property' && parent.key === n)) add('T-LINT-7', f, n.loc.start.line, n.name);
    });
  }

  for (const f of all.filter((p) => extname(p) === '.html')) {
    if (/\son[a-z]+\s*=/i.test(read(f))) add('T-LINT-5', f, 0, 'inline handler');
    if (/<script(?![^>]*\ssrc=)[^>]*>/i.test(read(f))) add('T-LINT-5', f, 0, 'inline script');
    if (/\sstyle\s*=/i.test(read(f))) add('T-LINT-5', f, 0, 'inline style');
  }

  const spacingProps = /^(margin|padding|gap|row-gap|column-gap|inset|top|right|bottom|left|margin-[a-z]+|padding-[a-z]+)$/;
  for (const f of all.filter((p) => extname(p) === '.css')) {
    const text = read(f);
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      const m = /^\s*([a-z-]+)\s*:\s*([^;]+);/.exec(line);
      if (m && spacingProps.test(m[1])) {
        const bad = m[2].replace(/var\(--[a-z0-9-]+\)/g, '').replace(/calc\(|\)/g, '').match(/-?\d*\.?\d+px/g);
        if (bad) add('T-LINT-3', f, i + 1, `${m[1]}: ${m[2]}`);
      }
      if (m && rel(f) !== 'styles/tokens.css' && rel(f) !== 'styles/print.css') {
        if (/^border(-[a-z]+)*-radius$/.test(m[1])) {
          const rest = m[2].replace(/var\(--r-[a-z0-9-]+\)/g, '').replace(/50%|\b0\b/g, '').trim();
          if (rest) add('T-LINT-17', f, i + 1, `${m[1]}: ${m[2]}`);
        }
        if (/^(min-)?height$/.test(m[1])) {
          const px = /^(\d+(?:\.\d+)?)px$/.exec(m[2].trim());
          if (px && Number(px[1]) >= 24) add('T-LINT-17', f, i + 1, `${m[1]}: ${m[2]}`);
        }
      }
      if (rel(f) !== 'styles/tokens.css' && /#[0-9A-Fa-f]{3,8}\b/.test(line) && !/url\(/.test(line)) add('T-LINT-6', f, i + 1, 'hex colour');
      if (rel(f) !== 'styles/tokens.css' && /\brgba?\(/.test(line)) add('T-LINT-6', f, i + 1, 'rgb colour');
    });
  }

  const strings = parsed.get(join(root, 'src/ui/strings.js'));
  if (strings) {
    const banned = /(!|please|oops|sorry|\p{Extended_Pictographic})/iu;
    visit(strings.ast, (n) => {
      if (n.type === 'Literal' && typeof n.value === 'string' && banned.test(n.value)) add('T-LINT-9', join(root, 'src/ui/strings.js'), n.loc.start.line, n.value);
      if (n.type === 'TemplateElement' && banned.test(n.value.cooked)) add('T-LINT-9', join(root, 'src/ui/strings.js'), n.loc.start.line, n.value.cooked);
    });
  }

  const uiFiles = srcJs.filter((p) => (rel(p).startsWith('src/ui/') || rel(p).startsWith('src/app/')) && rel(p) !== 'src/ui/strings.js');
  const textLike = (v) => /[A-Za-z]{3,}/.test(v) && /\s/.test(v.trim()) || /^[A-Z][a-z]{2,}[.:]?$/.test(v.trim());
  for (const f of uiFiles) {
    const entry = parsed.get(f);
    if (!entry) continue;
    visit(entry.ast, (n) => {
      if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'h') {
        n.arguments.slice(2).forEach((a) => {
          if (a.type === 'Literal' && typeof a.value === 'string' && /[A-Za-z]/.test(a.value) && a.value.trim().length > 0 && !/^[\s·›↵↑↓⚙●:,.()]+$/.test(a.value)) add('T-LINT-9', f, a.loc.start.line, `literal child "${a.value}"`);
          if (a.type === 'TemplateLiteral' && a.quasis.some((q) => /[A-Za-z]{3,}/.test(q.value.cooked))) add('T-LINT-9', f, a.loc.start.line, 'template child');
        });
        const attrs = n.arguments[1];
        if (attrs && attrs.type === 'ObjectExpression') {
          for (const p of attrs.properties) {
            const key = p.key && (p.key.name || p.key.value);
            if (['title', 'aria-label', 'alt', 'placeholder'].includes(key) && p.value.type === 'Literal' && typeof p.value.value === 'string' && /[A-Za-z]{2,}/.test(p.value.value)) add('T-LINT-9', f, p.loc.start.line, `${key} "${p.value.value}"`);
            if (['title', 'aria-label'].includes(key) && p.value.type === 'TemplateLiteral' && p.value.quasis.some((q) => /[A-Za-z]{3,}/.test(q.value.cooked))) add('T-LINT-9', f, p.loc.start.line, `${key} template`);
          }
        }
      }
      if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression' && n.left.property.name === 'textContent' && n.right.type === 'Literal' && typeof n.right.value === 'string' && n.right.value.length > 0) add('T-LINT-9', f, n.loc.start.line, `textContent "${n.right.value}"`);
      if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && ['setMessage'].includes(n.callee.property.name) && n.arguments[0] && n.arguments[0].type === 'Literal' && textLike(String(n.arguments[0].value))) add('T-LINT-9', f, n.loc.start.line, `message "${n.arguments[0].value}"`);
    });
  }

  const selfCheckFiles = new Set();
  for (const f of srcJs) {
    const entry = parsed.get(f);
    if (!entry) continue;
    visitWithAncestors(entry.ast, (n, ancestors) => {
      if (n.type === 'Identifier' && n.name === 'selfCheck') selfCheckFiles.add(rel(f));
      if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'selfCheck') {
        ancestors.forEach((a, i) => {
          if (a.type === 'TryStatement' && ancestors[i + 1] === a.block && (!a.handler || !containsThrow(a.handler.body))) add('T-LINT-12', f, n.loc.start.line, 'selfCheck called inside a try block whose catch does not rethrow');
        });
      }
    });
  }
  if (selfCheckFiles.size !== 1 || !selfCheckFiles.has('src/core/save.js')) add('T-LINT-12', join(root, 'src/core/save.js'), 0, `selfCheck must be defined and used only in src/core/save.js, found in: ${[...selfCheckFiles].join(', ') || 'nowhere'}`);

  const tokensCss = read(join(root, 'styles', 'tokens.css'));
  const appCss = read(join(root, 'styles', 'app.css'));
  const bodyRule = /(?:^|\n)body\s*\{[^}]*?background:\s*var\((--[a-z0-9-]+)\)/.exec(appCss);
  const groundToken = bodyRule ? bodyRule[1] : null;
  if (!groundToken) add('T-LINT-13', join(root, 'styles', 'app.css'), 0, 'body background does not use a token');
  else {
    const ground = { light: cssToken(cssBlock(tokensCss, ':root {'), groundToken), dark: cssToken(cssBlock(tokensCss, ':root[data-theme="dark"]'), groundToken) };
    if (!ground.light || !ground.dark) add('T-LINT-13', join(root, 'styles', 'tokens.css'), 0, `${groundToken} missing a light or dark value`);
    const html = read(join(root, 'index.html'));
    for (const scheme of ['light', 'dark']) {
      const m = new RegExp(`<meta name="theme-color" content="(#[0-9A-Fa-f]{6})" media="\\(prefers-color-scheme: ${scheme}\\)">`).exec(html);
      if (!m) add('T-LINT-13', join(root, 'index.html'), 0, `no ${scheme} theme-color meta`);
      else if (m[1].toUpperCase() !== ground[scheme]) add('T-LINT-13', join(root, 'index.html'), 0, `${scheme} theme-color ${m[1]} is not ${groundToken} ${ground[scheme]}`);
    }
    const manifest = JSON.parse(read(join(root, 'manifest.webmanifest')));
    for (const key of ['theme_color', 'background_color']) {
      if (String(manifest[key]).toUpperCase() !== ground.light) add('T-LINT-13', join(root, 'manifest.webmanifest'), 0, `${key} ${manifest[key]} is not ${groundToken} ${ground.light}`);
    }
  }

  const directives = (policy) => policy.split(';').map((d) => d.trim().replace(/\s+/g, ' ')).filter(Boolean).sort();
  const cspSources = {
    'index.html': /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(read(join(root, 'index.html'))),
    '_headers': /Content-Security-Policy:\s*(.+)/.exec(read(join(root, '_headers'))),
    'vercel.json': /"key": "Content-Security-Policy", "value": "([^"]+)"/.exec(read(join(root, 'vercel.json'))),
    'tests/e2e/server.js': /'Content-Security-Policy': "([^"]+)"/.exec(read(join(root, 'tests', 'e2e', 'server.js')))
  };
  const policies = {};
  for (const [name, m] of Object.entries(cspSources)) {
    if (!m) add('T-LINT-14', join(root, name), 0, 'Content-Security-Policy not found');
    else policies[name] = directives(m[1]);
  }
  const isAncestors = (d) => d.startsWith('frame-ancestors');
  if (policies['index.html'] && policies['index.html'].some(isAncestors)) add('T-LINT-14', join(root, 'index.html'), 0, 'frame-ancestors is ignored in a meta policy and logs a console error');
  const reference = policies['_headers'];
  for (const [name, list] of Object.entries(policies)) {
    if (!reference) break;
    const expected = name === 'index.html' ? reference.filter((d) => !isAncestors(d)) : reference;
    if (JSON.stringify(list) !== JSON.stringify(expected)) add('T-LINT-14', join(root, name), 0, `policy differs from _headers: ${list.filter((d) => !expected.includes(d)).join(' | ')} / missing ${expected.filter((d) => !list.includes(d)).join(' | ')}`);
  }

  const errorKeys = new Set();
  const stringsEntry = parsed.get(join(root, 'src', 'ui', 'strings.js'));
  if (stringsEntry) {
    visit(stringsEntry.ast, (n) => {
      if (n.type === 'VariableDeclarator' && n.id.name === 'ERRORS' && n.init && n.init.type === 'ObjectExpression') {
        for (const prop of n.init.properties) errorKeys.add(prop.key.value !== undefined ? prop.key.value : prop.key.name);
      }
    });
  }
  if (!errorKeys.size) add('T-LINT-15', join(root, 'src', 'ui', 'strings.js'), 0, 'ERRORS table not found');
  for (const f of srcJs) {
    const entry = parsed.get(f);
    if (!entry) continue;
    visit(entry.ast, (n) => {
      if (n.type === 'NewExpression' && n.callee.type === 'Identifier' && n.callee.name === 'QuoinError') {
        const first = n.arguments[0];
        if (!first || first.type !== 'Literal' || typeof first.value !== 'string') add('T-LINT-15', f, n.loc.start.line, 'QuoinError code must be a string literal');
        else if (errorKeys.size && !errorKeys.has(first.value)) add('T-LINT-15', f, n.loc.start.line, `no message for ${first.value}`);
      }
    });
  }

  const fontDir = join(root, 'public', 'fonts');
  const cssText = all.filter((p) => extname(p) === '.css' && rel(p).startsWith('styles/')).map(read).join('\n');
  for (const name of readdirSync(fontDir)) {
    if (!/\.(woff2?|ttf|otf)$/i.test(name)) continue;
    if (!new RegExp(`src:[^;]*url\\(["']?[^)]*fonts/${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?\\)`).test(cssText)) add('T-LINT-11', join(fontDir, name), 0, 'font file not referenced by an @font-face');
  }

  const letterOrDigit = /[\p{L}\p{N}]/u;
  const stringLeaves = (node) => {
    if (!node) return [];
    if (node.type === 'Literal' && typeof node.value === 'string') return [node];
    if (node.type === 'ConditionalExpression') return [...stringLeaves(node.consequent), ...stringLeaves(node.alternate)];
    return [];
  };
  for (const f of uiFiles) {
    const entry = parsed.get(f);
    if (!entry) continue;
    visitWithAncestors(entry.ast, (n, ancestors) => {
      if (n.type === 'Property' && !n.computed && n.key && (n.key.name === 'text' || n.key.value === 'text')) {
        for (const leaf of stringLeaves(n.value)) if (letterOrDigit.test(leaf.value)) add('T-LINT-9', f, leaf.loc.start.line, `text "${leaf.value}"`);
      }
      if (n.type === 'ReturnStatement') {
        const fn = [...ancestors].reverse().find((a) => a.type === 'FunctionDeclaration' || a.type === 'FunctionExpression' || a.type === 'ArrowFunctionExpression');
        const name = fn && fn.type === 'FunctionDeclaration' && fn.id ? fn.id.name : '';
        if (/(Label|Text|Display)$/.test(name)) for (const leaf of stringLeaves(n.argument)) if (letterOrDigit.test(leaf.value)) add('T-LINT-9', f, leaf.loc.start.line, `${name} returns "${leaf.value}"`);
      }
    });
  }

  const queryParamUses = [];
  for (const f of srcJs) {
    if (/location\.search|URLSearchParams/.test(read(f))) queryParamUses.push(rel(f));
  }
  if (queryParamUses.some((p) => p !== 'src/app/main.js')) add('T-LINT-10', join(root, 'src/app/main.js'), 0, 'query string read outside main.js');

  for (const f of srcJs) {
    if (!parsed.has(f)) continue;
    for (const x of oneExecuteEntryFindings(rel(f), read(f))) add('T-LINT-21', f, x.line, x.msg);
  }

  for (const f of walk(root)) {
    if (!/\.(js|mjs|json|md|css|html|yml|yaml|svg|webmanifest)$/.test(f) || rel(f) === 'package-lock.json') continue;
    for (const x of conflictMarkerFindings(read(f))) add('T-LINT-22', f, x.line, x.msg);
  }

  return findings;
}

export function conflictMarkerFindings(text) {
  const out = [];
  text.split('\n').forEach((line, n) => {
    if (/^<{7} \S/.test(line) || /^>{7} \S/.test(line)) out.push({ line: n + 1, msg: 'merge conflict marker' });
  });
  return out;
}

export function printFindings(findings) {
  for (const f of findings) console.log(`${f.rule} ${f.file}:${f.line} ${f.msg}`);
}

const EXECUTE_ENTRY_FILES = new Set(['src/batch/execute/index.js', 'src/core/save.js']);
const SAVE_PART = 'src/core/save.js';

export function oneExecuteEntryFindings(relPath, text) {
  if (!relPath.startsWith('src/') || EXECUTE_ENTRY_FILES.has(relPath)) return [];
  const out = [];
  const resolvesToSave = (spec) => typeof spec === 'string' && spec.startsWith('.') && posix.normalize(posix.join(posix.dirname(relPath), spec)) === SAVE_PART;
  visit(parseSource(text).ast, (n) => {
    const line = n.loc ? n.loc.start.line : 0;
    if (n.type === 'ImportDeclaration' && resolvesToSave(n.source.value)) {
      for (const sp of n.specifiers) {
        if (sp.type === 'ImportNamespaceSpecifier') out.push({ line, msg: 'namespace import of src/core/save.js' });
        else if (sp.type === 'ImportSpecifier' && (sp.imported.name || sp.imported.value) === 'applyChangeSet') out.push({ line, msg: 'applyChangeSet' });
      }
    }
    if (n.type === 'ExportNamedDeclaration' && n.source && resolvesToSave(n.source.value)) {
      for (const sp of n.specifiers) if ((sp.local.name || sp.local.value) === 'applyChangeSet') out.push({ line, msg: 'applyChangeSet' });
    }
    if (n.type === 'ExportAllDeclaration' && resolvesToSave(n.source.value)) out.push({ line, msg: 'namespace import of src/core/save.js' });
    if (n.type === 'ImportExpression' && n.source.type === 'Literal' && resolvesToSave(n.source.value)) out.push({ line, msg: 'dynamic import of src/core/save.js' });
  });
  return out;
}
