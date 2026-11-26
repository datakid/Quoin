import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const map = JSON.parse(readFileSync(join(root, 'docs', 'fable', 'ownership.json'), 'utf8'));

function matcher(glob) {
  let source = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      source += '.*';
      i += 1;
      if (glob[i + 1] === '/') i += 1;
    } else if (c === '*') {
      source += '[^/]*';
    } else {
      source += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

const compiled = Object.entries(map.lanes).map(([lane, def]) => ({ lane, tests: def.owns.map((g) => ({ glob: g, re: matcher(g) })) }));

function ownersOf(file) {
  const out = [];
  for (const { lane, tests } of compiled) if (tests.some((t) => t.re.test(file))) out.push(lane);
  return out.length ? out : ['integrator'];
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean);
}

function checkMap() {
  const files = git(['ls-files']);
  const clashes = [];
  for (const file of files) {
    const owners = compiled.filter(({ tests }) => tests.some((t) => t.re.test(file))).map((x) => x.lane);
    if (owners.length > 1) clashes.push(`${file}: ${owners.join(', ')}`);
  }
  const dead = [];
  for (const { lane, tests } of compiled) for (const t of tests) if (!files.some((f) => t.re.test(f))) dead.push(`${lane}: ${t.glob}`);
  return { clashes, dead };
}

function changedSince(base) {
  const committed = git(['diff', '--name-only', `${base}...HEAD`]);
  const working = git(['diff', '--name-only', 'HEAD']);
  const untracked = git(['ls-files', '--others', '--exclude-standard']);
  return [...new Set([...committed, ...working, ...untracked])].sort();
}

const [mode, lane, base = 'origin/fable'] = process.argv.slice(2);

if (mode === 'map') {
  const { clashes, dead } = checkMap();
  for (const c of clashes) console.log(`OVERLAP ${c}`);
  for (const d of dead) console.log(`NO FILE ${d}`);
  if (clashes.length) process.exit(1);
  console.log(`ownership map ok: ${Object.keys(map.lanes).length} lanes, no file has two owners`);
} else if (mode === 'lane' && map.lanes[lane]) {
  const changed = changedSince(base);
  const foreign = changed.filter((f) => !ownersOf(f).includes(lane));
  for (const f of foreign) console.log(`NOT OWNED by ${lane}: ${f} (owner: ${ownersOf(f).join(', ')})`);
  if (foreign.length) process.exit(1);
  console.log(`${lane}: ${changed.length} changed files, all owned`);
} else if (mode === 'who') {
  for (const f of process.argv.slice(3)) console.log(`${f}: ${ownersOf(f).join(', ')}`);
} else {
  console.log('usage: check-ownership.mjs map | lane <name> [baseRef] | who <file...>');
  process.exit(2);
}
