import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXCEL_ROW, RESULT_COLUMNS } from './make-excel-kit.mjs';

const CHECKS = [
  { column: 'opened_without_repair', step: 'opening the output: no repair message' },
  { column: 'queries_ran', step: 'the lines about refreshing queries' },
  { column: 'macros_ran', step: 'the lines about macros and the VBA editor' },
  { column: 'output_looked_right', step: 'the lines about what the output should show' }
];
const VALUES = new Map([['yes', 'yes'], ['no', 'no'], ['cannot', 'cannot']]);

export function parseCsv(text) {
  const body = text.replace(/^\uFEFF/, '');
  const firstLine = body.split(/\r?\n/, 1)[0];
  const delimiter = firstLine.includes(',') || !firstLine.includes(';') ? ',' : ';';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const packOf = (id) => (/^X\d\d$/i.test(id) ? 'quoin-excel-pack-scope' : 'quoin-excel-pack');
const sectionOf = (id) => (/^X\d\d$/i.test(id) ? id.toUpperCase() : id.slice(0, 2));

export function readResults(text) {
  const rows = parseCsv(text);
  const header = (rows[0] || []).map((c) => c.trim().toLowerCase());
  if (header.length < RESULT_COLUMNS.length || RESULT_COLUMNS.some((c, i) => header[i] !== c)) {
    return { valid: false, problem: `the first row must be ${RESULT_COLUMNS.join(', ')}; this file is not a RESULTS.csv from the kit` };
  }
  const problems = [];
  const cases = new Map();
  let excel = '';
  for (const raw of rows.slice(1)) {
    const cells = RESULT_COLUMNS.map((_, i) => (raw[i] || '').trim());
    const id = cells[0];
    if (id.toLowerCase() === EXCEL_ROW) {
      excel = cells[5];
      continue;
    }
    if (cases.has(id)) problems.push(`case ${id} appears more than once; the first row is used`);
    else cases.set(id, cells);
  }
  const rowsOut = [];
  const tally = Object.fromEntries(CHECKS.map((c) => [c.column, { yes: [], no: [], cannot: [], notChecked: [], invalid: [] }]));
  for (const [id, cells] of cases) {
    CHECKS.forEach((check, k) => {
      const raw = cells[k + 1];
      const value = raw === '' ? 'notChecked' : VALUES.get(raw.toLowerCase());
      if (!value) {
        tally[check.column].invalid.push(id);
        problems.push(`case ${id}, ${check.column}: "${raw}" is not yes, no or cannot, so it is not counted`);
      } else tally[check.column][value].push(id);
    });
    rowsOut.push({ id, pack: packOf(id), section: sectionOf(id), values: Object.fromEntries(CHECKS.map((c, k) => [c.column, cells[k + 1]])), note: cells[5] });
  }
  const failed = [];
  for (const row of rowsOut) {
    for (const check of CHECKS) if (tally[check.column].no.includes(row.id)) failed.push({ case: row.id, pack: row.pack, section: row.section, column: check.column, step: check.step, note: row.note });
  }
  const cannot = rowsOut.filter((r) => CHECKS.some((c) => tally[c.column].cannot.includes(r.id))).map((r) => ({ case: r.id, columns: CHECKS.filter((c) => tally[c.column].cannot.includes(r.id)).map((c) => c.column) }));
  return { valid: true, excel, cases: rowsOut.length, rows: rowsOut, tally, failed, cannot, problems };
}

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function claimOf(result, check) {
  const t = result.tally[check.column];
  const filled = t.yes.length + t.no.length;
  return { yes: t.yes.length, no: t.no.length, cannot: t.cannot.length, notChecked: t.notChecked.length, filled };
}

export function describe(result) {
  if (!result.valid) return { claims: [], readme: '', text: `Cannot read this file: ${result.problem}.\n` };
  const n = result.cases;
  const edition = result.excel || null;
  const opened = claimOf(result, CHECKS[0]);
  const queries = claimOf(result, CHECKS[1]);
  const macros = claimOf(result, CHECKS[2]);
  const output = claimOf(result, CHECKS[3]);
  const any = CHECKS.some((c) => claimOf(result, c).filled > 0);
  const claims = [];
  const part = (c, ok, bad, what) => `Of the ${count(c.filled, 'case', 'cases')} checked ${what}, ${c.yes} ${ok}${c.no ? ` and ${c.no} ${bad}` : ''}${c.notChecked ? `; ${count(c.notChecked, 'case was', 'cases were')} not checked for this` : ''}.`;
  if (opened.filled) claims.push(part(opened, 'opened without one', 'showed one', 'for a repair message'));
  if (queries.filled) claims.push(part(queries, 'ran the queries without an error', 'had a query error', 'for the queries'));
  if (macros.filled) claims.push(part(macros, 'ran the macros', 'did not', 'for the macros'));
  claims.push(output.filled ? part(output, 'looked right', 'did not', 'for the output') : 'The outputs were not reviewed.');
  const emptyRows = result.rows.filter((r) => CHECKS.every((c) => r.values[c.column] === '')).length;
  const readme = any
    ? `Checked in real Excel${edition ? ` (${edition})` : ' (edition and version not given)'}: ${claims.join(' ')}`
    : 'Nothing has been checked in real Excel yet.';
  const lines = [];
  lines.push(`Excel edition and version: ${edition || 'not given. Nothing below can be tied to an Excel version.'}`);
  lines.push(`Cases in the file: ${n}`);
  lines.push('');
  for (const check of CHECKS) {
    const c = claimOf(result, check);
    lines.push(`${check.column}: yes ${c.yes}, no ${c.no}, cannot ${c.cannot}, not checked ${c.notChecked}${result.tally[check.column].invalid.length ? `, not understood ${result.tally[check.column].invalid.length}` : ''}`);
  }
  lines.push('');
  if (!any) {
    lines.push('Nothing was checked: no cell is filled in. There is no wording for docs/observations.md or the README.');
  } else {
    lines.push('Wording for docs/observations.md and the README sentence about real Excel:');
    lines.push('');
    lines.push(readme);
    if (emptyRows > 0) lines.push(`${count(emptyRows, 'case has', 'cases have')} no cell filled in.`);
  }
  lines.push('');
  lines.push(result.failed.length ? 'Cases that failed:' : 'Cases that failed: none marked no.');
  for (const f of result.failed) lines.push(`- ${f.case} (${f.pack}, checklist section ${f.section}, step: ${f.step})${f.note ? `: ${f.note}` : ': no note'}`);
  if (result.cannot.length) {
    lines.push('');
    lines.push('Steps that could not be done on this Excel:');
    for (const c of result.cannot) lines.push(`- ${c.case}: ${c.columns.join(', ')}`);
  }
  if (result.problems.length) {
    lines.push('');
    lines.push('Problems with the file:');
    for (const p of result.problems) lines.push(`- ${p}`);
  }
  return { claims, readme, text: `${lines.join('\n')}\n` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    process.stderr.write('usage: node scripts/read-excel-results.mjs <RESULTS.csv> [--json]\n');
    process.exit(2);
  }
  const result = readResults(readFileSync(resolve(file), 'utf8'));
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify({ result, ...describe(result) }, null, 2)}\n`);
  else process.stdout.write(describe(result).text);
  process.exit(result.valid ? 0 : 1);
}
