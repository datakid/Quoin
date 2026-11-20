import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlan } from '../../src/batch/resolve/resolve.js';
import { inspectNeeds } from '../../src/batch/resolve/scope.js';
import { parseRecipe } from '../../src/batch/recipe/recipe.js';

const NOW = '2026-11-14T10:00:00.000Z';
const M = 'let Source = Excel.CurrentWorkbook(){[Name="{unit.name}"]}[Content] in Source';

const recipeOf = (kind, extra = {}) => {
  const parsed = parseRecipe(JSON.stringify({ recipe: kind, v: 1, ...(kind === 'transform' ? { query: { source: 'inline', m: M } } : {}), ...extra }));
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  return parsed.recipe;
};
const transform = (scope, extra = {}) => recipeOf('transform', { scope: { type: 'sheets', match: 'all', ...scope }, ...extra });
const collect = (extra = {}) => recipeOf('collect', extra);

const sheet = (name, index, { state = 'visible', type = 'worksheet', nonEmpty = null } = {}) => ({ name, index, state, type, part: `xl/worksheets/sheet${index + 1}.xml`, nonEmpty });
const table = (name, sheetName, ref = 'A1:C4', headerRowCount = 1) => ({ name, sheet: sheetName, ref, headerRowCount, tableType: 'worksheet' });
const book = (id, relPath, { sheets = [], tables = [] } = {}) => ({
  id,
  name: relPath.split('/').pop(),
  relPath,
  size: 10,
  status: 'ready',
  refused: null,
  format: 'xlsx',
  sheets,
  tables,
  queries: [],
  modules: [],
  pq: { editable: true, reason: null },
  vba: { present: false, signed: false, locked: false, writable: true },
  warnings: []
});
const withSheets = (id, relPath, names, options) => book(id, relPath, { sheets: names.map((n, i) => sheet(n, i, options && options[n])) });

const unitsOf = (plan, fileId = plan.files[0].fileId) => plan.files.find((f) => f.fileId === fileId).units;
const namesOf = (plan, fileId) => unitsOf(plan, fileId).map((u) => u.name);

test('a transform plan over sheets has one sheet unit per worksheet, numbered in workbook order', () => {
  const plan = resolvePlan(transform({}), [withSheets('f1', 'a.xlsx', ['Data', 'Notes', 'Summary'])], { now: NOW });
  assert.deepEqual(unitsOf(plan), [
    { fileId: 'f1', kind: 'sheet', name: 'Data', index: 1 },
    { fileId: 'f1', kind: 'sheet', name: 'Notes', index: 2 },
    { fileId: 'f1', kind: 'sheet', name: 'Summary', index: 3 }
  ]);
  assert.equal(plan.files[0].source, 'rule');
  assert.equal(plan.files[0].skipped, null);
});

test('each unit gets one transform action carrying the compute mode and the unit as target', () => {
  const plan = resolvePlan(transform({}, { compute: 'excel' }), [withSheets('f1', 'a.xlsx', ['Data', 'Notes'])], { now: NOW });
  assert.deepEqual(plan.files[0].actions.map((a) => [a.op, a.target, a.compute, a.output, a.replaces]), [
    ['transform', { type: 'sheet', name: 'Data' }, 'excel', null, null],
    ['transform', { type: 'sheet', name: 'Notes' }, 'excel', null, null]
  ]);
  for (const [i, a] of plan.files[0].actions.entries()) assert.deepEqual(a.unit, plan.files[0].units[i]);
});

test('a workbook scope on a transform recipe is one workbook unit per file', () => {
  const plan = resolvePlan(recipeOf('transform', { scope: { type: 'workbook' } }), [withSheets('f1', 'dir/Sales 2024.xlsx', ['Data', 'Notes'])], { now: NOW });
  assert.deepEqual(unitsOf(plan), [{ fileId: 'f1', kind: 'workbook', name: 'Sales 2024', index: 1 }]);
});

test('hidden and very hidden sheets are left out unless excludeHidden is false', () => {
  const file = book('f1', 'a.xlsx', { sheets: [sheet('A', 0), sheet('B', 1, { state: 'hidden' }), sheet('C', 2, { state: 'veryHidden' }), sheet('D', 3)] });
  assert.deepEqual(namesOf(resolvePlan(transform({}), [file], { now: NOW })), ['A', 'D']);
  assert.deepEqual(namesOf(resolvePlan(transform({ excludeHidden: false }), [file], { now: NOW })), ['A', 'B', 'C', 'D']);
});

test('chart sheets are never units', () => {
  const file = book('f1', 'a.xlsx', { sheets: [sheet('Chart', 0, { type: 'chartsheet' }), sheet('Data', 1)] });
  assert.deepEqual(namesOf(resolvePlan(transform({}), [file], { now: NOW })), ['Data']);
});

test('a glob pattern is case-insensitive and understands star and question mark', () => {
  const file = withSheets('f1', 'a.xlsx', ['Data', 'data2', 'Notes', 'DATA_final', 'Dat']);
  const run = (pattern) => namesOf(resolvePlan(transform({ match: 'pattern', pattern }), [file], { now: NOW }));
  assert.deepEqual(run('data*'), ['Data', 'data2', 'DATA_final']);
  assert.deepEqual(run('DATA?'), ['data2']);
  assert.deepEqual(run('data'), ['Data']);
  assert.deepEqual(run('*a*'), ['Data', 'data2', 'DATA_final', 'Dat']);
});

test('every other character in a glob is literal', () => {
  const file = withSheets('f1', 'a.xlsx', ['a.b', 'axb', 'Q1 (draft)', 'Q1 draft', 'x+y', 'xxy', '1']);
  const run = (pattern) => namesOf(resolvePlan(transform({ match: 'pattern', pattern }), [file], { now: NOW }));
  assert.deepEqual(run('a.b'), ['a.b']);
  assert.deepEqual(run('Q1 (draft)'), ['Q1 (draft)']);
  assert.deepEqual(run('x+y'), ['x+y']);
});

test('a regex pattern matches anywhere in the name and is case-sensitive unless it says otherwise', () => {
  const file = withSheets('f1', 'a.xlsx', ['Q1 Sales', 'Q2 sales', 'Data1', 'Data22']);
  const run = (pattern) => namesOf(resolvePlan(transform({ match: 'pattern', pattern, patternKind: 'regex' }), [file], { now: NOW }));
  assert.deepEqual(run('Sales'), ['Q1 Sales']);
  assert.deepEqual(run('^Data\\d$'), ['Data1']);
  assert.deepEqual(run('^Q\\d'), ['Q1 Sales', 'Q2 sales']);
});

test('position picks first, last, an index or a range of the candidates', () => {
  const file = withSheets('f1', 'a.xlsx', ['A', 'B', 'C', 'D']);
  const run = (position) => namesOf(resolvePlan(transform({ match: 'position', position }), [file], { now: NOW }));
  assert.deepEqual(run({ kind: 'first' }), ['A']);
  assert.deepEqual(run({ kind: 'last' }), ['D']);
  assert.deepEqual(run({ kind: 'index', index: 3 }), ['C']);
  assert.deepEqual(run({ kind: 'range', from: 2, to: 3 }), ['B', 'C']);
  assert.deepEqual(run({ kind: 'range', from: 3, to: 9 }), ['C', 'D']);
});

test('a position beyond the candidates matches nothing and the file is skipped', () => {
  const plan = resolvePlan(transform({ match: 'position', position: { kind: 'index', index: 5 } }), [withSheets('f1', 'a.xlsx', ['A', 'B'])], { now: NOW });
  assert.deepEqual(plan.files[0].units, []);
  assert.deepEqual(plan.files[0].skipped, { code: 'skip.noMatchingUnit', detail: null });
});

test('position counts the candidates that are left after hidden sheets are dropped', () => {
  const file = book('f1', 'a.xlsx', { sheets: [sheet('Old', 0, { state: 'hidden' }), sheet('Main', 1), sheet('Extra', 2)] });
  assert.deepEqual(namesOf(resolvePlan(transform({ match: 'position', position: { kind: 'first' } }), [file], { now: NOW })), ['Main']);
  assert.deepEqual(namesOf(resolvePlan(transform({ match: 'position', position: { kind: 'first' }, excludeHidden: false }), [file], { now: NOW })), ['Old']);
});

test('only non-empty keeps sheets known to hold cells and position then counts the survivors', () => {
  const file = book('f1', 'a.xlsx', { sheets: [sheet('Blank', 0, { nonEmpty: false }), sheet('Data', 1, { nonEmpty: true }), sheet('More', 2, { nonEmpty: true })] });
  const plan = resolvePlan(transform({ onlyNonEmpty: true }), [file], { now: NOW });
  assert.deepEqual(namesOf(plan), ['Data', 'More']);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(namesOf(resolvePlan(transform({ onlyNonEmpty: true, match: 'position', position: { kind: 'first' } }), [file], { now: NOW })), ['Data']);
});

test('only non-empty on a sheet that was never inspected is a planning error and the sheet is kept', () => {
  const file = book('f1', 'a.xlsx', { sheets: [sheet('Data', 0, { nonEmpty: true }), sheet('Unknown', 1, { nonEmpty: null })] });
  const plan = resolvePlan(transform({ onlyNonEmpty: true }), [file], { now: NOW });
  assert.deepEqual(namesOf(plan), ['Data', 'Unknown']);
  assert.deepEqual(plan.errors, [{ code: 'scope.needsInspect', fileId: 'f1', detail: 'nonEmpty' }]);
});

test('inspectNeeds names the ready files that still need the non-empty check', () => {
  const inspected = book('f1', 'a.xlsx', { sheets: [sheet('Data', 0, { nonEmpty: true })] });
  const pending = book('f2', 'b.xlsx', { sheets: [sheet('Data', 0, { nonEmpty: null })] });
  const refused = { ...book('f3', 'c.xls'), status: 'refused', refused: { code: 'file.unsupportedExtension' } };
  assert.deepEqual(inspectNeeds(transform({ onlyNonEmpty: true }), [inspected, pending, refused]), ['f2']);
  assert.deepEqual(inspectNeeds(transform({}), [pending]), []);
  assert.deepEqual(inspectNeeds(collect(), [pending]), []);
  assert.deepEqual(inspectNeeds(recipeOf('transform', { scope: { type: 'tables', onlyNonEmpty: true } }), [pending]), []);
});

test('an explicit exclude beats an include and compares names without case', () => {
  const file = withSheets('f1', 'a.xlsx', ['Data', 'Data2', 'Notes']);
  const plan = resolvePlan(transform({ match: 'pattern', pattern: 'Data*', exclude: ['data2'] }), [file], { now: NOW });
  assert.deepEqual(namesOf(plan), ['Data']);
  assert.deepEqual(namesOf(resolvePlan(transform({ exclude: ['Notes'] }), [file], { now: NOW })), ['Data', 'Data2']);
});

test('a pin replaces the rule for its file and wins over hidden, pattern and exclude', () => {
  const hiddenData = book('f1', 'a.xlsx', { sheets: [sheet('Data', 0, { state: 'hidden' }), sheet('Other', 1), sheet('More', 2)] });
  const plain = withSheets('f2', 'b.xlsx', ['Data', 'Other']);
  const recipe = transform({ exclude: ['Data'] }, { overrides: [{ file: 'a.xlsx', path: 'a.xlsx', units: ['Data'] }] });
  const plan = resolvePlan(recipe, [hiddenData, plain], { now: NOW });
  assert.deepEqual(namesOf(plan, 'f1'), ['Data']);
  assert.equal(plan.files.find((f) => f.fileId === 'f1').source, 'pin');
  assert.deepEqual(namesOf(plan, 'f2'), ['Other']);
  assert.equal(plan.files.find((f) => f.fileId === 'f2').source, 'rule');
});

test('pinned units run in workbook order and match sheet names without case', () => {
  const plan = resolvePlan(transform({}, { overrides: [{ file: 'a.xlsx', path: 'a.xlsx', units: ['summary', 'DATA'] }] }), [withSheets('f1', 'a.xlsx', ['Data', 'Notes', 'Summary'])], { now: NOW });
  assert.deepEqual(unitsOf(plan), [
    { fileId: 'f1', kind: 'sheet', name: 'Data', index: 1 },
    { fileId: 'f1', kind: 'sheet', name: 'Summary', index: 2 }
  ]);
});

test('a pin follows its file by name when the folder changed', () => {
  const plan = resolvePlan(transform({}, { overrides: [{ file: 'sales.xlsx', path: 'old/sales.xlsx', units: ['Data'] }] }), [withSheets('f1', 'new/sales.xlsx', ['Data', 'Notes'])], { now: NOW });
  assert.equal(plan.files[0].source, 'pin');
  assert.deepEqual(namesOf(plan), ['Data']);
  assert.deepEqual(plan.orphanPins, []);
});

test('a pin picks between files of the same name by folder-relative path', () => {
  const files = [withSheets('f1', 'east/sales.xlsx', ['Data', 'Notes']), withSheets('f2', 'west/sales.xlsx', ['Data', 'Notes'])];
  const plan = resolvePlan(transform({}, { overrides: [{ file: 'sales.xlsx', path: 'west/sales.xlsx', units: ['Notes'] }] }), files, { now: NOW });
  assert.deepEqual([plan.files[0].source, namesOf(plan, 'f1')], ['rule', ['Data', 'Notes']]);
  assert.deepEqual([plan.files[1].source, namesOf(plan, 'f2')], ['pin', ['Notes']]);
  assert.deepEqual(plan.orphanPins, []);
});

test('a pin whose name is shared by several files and whose path matches none is orphaned, never guessed', () => {
  const files = [withSheets('f1', 'east/sales.xlsx', ['Data']), withSheets('f2', 'west/sales.xlsx', ['Data'])];
  const plan = resolvePlan(transform({}, { overrides: [{ file: 'sales.xlsx', path: 'north/sales.xlsx', units: ['Data'] }] }), files, { now: NOW });
  assert.deepEqual(plan.orphanPins, [{ file: 'north/sales.xlsx', units: ['Data'] }]);
  assert.deepEqual(plan.files.map((f) => f.source), ['rule', 'rule']);
});

test('a pin whose file is gone is an orphan and its path is reported', () => {
  const plan = resolvePlan(transform({}, { overrides: [{ file: 'gone.xlsx', path: 'east/gone.xlsx', units: ['Data'] }] }), [withSheets('f1', 'a.xlsx', ['Data'])], { now: NOW });
  assert.deepEqual(plan.orphanPins, [{ file: 'east/gone.xlsx', units: ['Data'] }]);
});

test('pinned units that the file does not have are reported as orphans and the rest still run', () => {
  const plan = resolvePlan(transform({}, { overrides: [{ file: 'a.xlsx', path: 'dir/a.xlsx', units: ['Data', 'Extra'] }] }), [withSheets('f1', 'dir/a.xlsx', ['Data', 'Notes'])], { now: NOW });
  assert.deepEqual(namesOf(plan), ['Data']);
  assert.deepEqual(plan.orphanPins, [{ file: 'dir/a.xlsx', units: ['Extra'] }]);
});

test('a pin that matches nothing in its file leaves the file skipped with no matching unit', () => {
  const plan = resolvePlan(transform({}, { overrides: [{ file: 'a.xlsx', path: 'a.xlsx', units: ['Extra'] }] }), [withSheets('f1', 'a.xlsx', ['Data'])], { now: NOW });
  assert.deepEqual([plan.files[0].source, plan.files[0].units, plan.files[0].skipped], ['pin', [], { code: 'skip.noMatchingUnit', detail: null }]);
  assert.deepEqual(plan.orphanPins, [{ file: 'a.xlsx', units: ['Extra'] }]);
});

test('two pins for one file: the later one wins', () => {
  const overrides = [{ file: 'a.xlsx', path: 'a.xlsx', units: ['Data'] }, { file: 'a.xlsx', path: 'a.xlsx', units: ['Notes'] }];
  const plan = resolvePlan(transform({}, { overrides }), [withSheets('f1', 'a.xlsx', ['Data', 'Notes'])], { now: NOW });
  assert.deepEqual(namesOf(plan), ['Notes']);
});

test('a file that resolves to nothing is skipped, counted in no total, and is not an error', () => {
  const plan = resolvePlan(transform({ match: 'pattern', pattern: 'Data*' }), [withSheets('f1', 'a.xlsx', ['Data']), withSheets('f2', 'b.xlsx', ['Notes'])], { now: NOW });
  const skipped = plan.files.find((f) => f.fileId === 'f2');
  assert.deepEqual([skipped.units, skipped.actions, skipped.skipped], [[], [], { code: 'skip.noMatchingUnit', detail: null }]);
  assert.deepEqual(plan.summary, { files: 1, units: 1, groups: [{ unitsPerFile: 1, files: 1 }] });
  assert.deepEqual(plan.errors, []);
});

test('divergence is a fact in the summary: seven files with one unit and three files with two', () => {
  const files = [];
  for (let i = 1; i <= 7; i++) files.push(withSheets(`s${i}`, `one/f${i}.xlsx`, ['Data']));
  for (let i = 1; i <= 3; i++) files.push(withSheets(`t${i}`, `two/f${i}.xlsx`, ['Data', 'Notes']));
  files.push({ ...book('x1', 'old/a.xls'), status: 'refused', refused: { code: 'file.unsupportedExtension' } }, { ...book('x2', 'old/b.xls'), status: 'refused', refused: { code: 'file.unsupportedExtension' } });
  const overrides = files.filter((f) => f.id.startsWith('s')).map((f) => ({ file: f.name, path: f.relPath, units: ['Data'] }));
  const plan = resolvePlan(transform({}, { overrides }), files, { now: NOW });
  assert.deepEqual(plan.summary, { files: 10, units: 13, groups: [{ unitsPerFile: 1, files: 7 }, { unitsPerFile: 2, files: 3 }] });
});

test('a refused file has no units under a sheet scope either', () => {
  const refused = { ...book('f1', 'old.xls'), status: 'refused', refused: { code: 'file.unsupportedExtension' } };
  const plan = resolvePlan(transform({}), [refused], { now: NOW });
  assert.deepEqual([plan.files[0].units, plan.files[0].skipped], [[], { code: 'file.unsupportedExtension', detail: null }]);
});

const tabled = book('f1', 'a.xlsx', {
  sheets: [sheet('Input', 0), sheet('Hidden', 1, { state: 'hidden' }), sheet('Out', 2)],
  tables: [table('Zed', 'Out', 'A1:B5'), table('Alpha', 'Input', 'A1:C9'), table('Quiet', 'Hidden', 'A1:B3'), table('Raw', 'Input', 'B2:C6', 0), table('Bare', 'Out', 'D1:E1')]
});

test('a table scope has one table unit per table, ordered by sheet and then by position in the workbook', () => {
  const plan = resolvePlan(recipeOf('transform', { scope: { type: 'tables', match: 'all' } }), [tabled], { now: NOW });
  assert.deepEqual(unitsOf(plan).map((u) => [u.kind, u.name, u.index]), [['table', 'Alpha', 1], ['table', 'Raw', 2], ['table', 'Zed', 3], ['table', 'Bare', 4]]);
  assert.deepEqual(plan.files[0].actions.map((a) => a.target), [{ type: 'range', name: 'Alpha' }, { type: 'range', name: 'Raw' }, { type: 'range', name: 'Zed' }, { type: 'range', name: 'Bare' }]);
});

test('hidden sheets hide their tables unless excludeHidden is false', () => {
  const plan = resolvePlan(recipeOf('transform', { scope: { type: 'tables', match: 'all', excludeHidden: false } }), [tabled], { now: NOW });
  assert.deepEqual(namesOf(plan), ['Alpha', 'Raw', 'Quiet', 'Zed', 'Bare']);
});

test('only with a header row keeps tables whose header row count is at least one', () => {
  const plan = resolvePlan(recipeOf('transform', { scope: { type: 'tables', match: 'all', onlyWithHeader: true } }), [tabled], { now: NOW });
  assert.deepEqual(namesOf(plan), ['Alpha', 'Zed', 'Bare']);
  assert.deepEqual(plan.errors, []);
});

test('only non-empty on tables keeps tables with at least one row below the header', () => {
  const plan = resolvePlan(recipeOf('transform', { scope: { type: 'tables', match: 'all', onlyNonEmpty: true } }), [tabled], { now: NOW });
  assert.deepEqual(namesOf(plan), ['Alpha', 'Raw', 'Zed']);
  assert.deepEqual(plan.errors, []);
});

test('a name pattern and a position work on tables too', () => {
  assert.deepEqual(namesOf(resolvePlan(recipeOf('transform', { scope: { type: 'tables', match: 'pattern', pattern: '?a*' } }), [tabled], { now: NOW })), ['Raw', 'Bare']);
  assert.deepEqual(namesOf(resolvePlan(recipeOf('transform', { scope: { type: 'tables', match: 'position', position: { kind: 'last' } } }), [tabled], { now: NOW })), ['Bare']);
});

test('table pins match table names and report the ones the file does not have', () => {
  const recipe = recipeOf('transform', { scope: { type: 'tables', match: 'all' }, overrides: [{ file: 'a.xlsx', path: 'a.xlsx', units: ['zed', 'Missing'] }] });
  const plan = resolvePlan(recipe, [tabled], { now: NOW });
  assert.deepEqual(unitsOf(plan), [{ fileId: 'f1', kind: 'table', name: 'Zed', index: 1 }]);
  assert.deepEqual(plan.orphanPins, [{ file: 'a.xlsx', units: ['Missing'] }]);
});

test('the header row filter does not apply to sheets: it is a planning error and nothing is filtered', () => {
  const plan = resolvePlan(transform({ onlyWithHeader: true }), [withSheets('f1', 'a.xlsx', ['Data', 'Notes'])], { now: NOW });
  assert.deepEqual(namesOf(plan), ['Data', 'Notes']);
  assert.deepEqual(plan.errors, [{ code: 'scope.headerOnSheets', detail: 'onlyWithHeader' }]);
});

test('the output name is filled in per unit, with the same tokens as the query', () => {
  const recipe = transform({}, { output: { mode: 'newFile', name: '{file.folder}{file.name}__{unit.name}-{unit.index}.xlsx' } });
  const plan = resolvePlan(recipe, [withSheets('f1', 'east/2024-sales.xlsx', ['Data', 'Notes'])], { now: NOW });
  assert.deepEqual(plan.files[0].actions.map((a) => a.output), [
    { mode: 'newFile', name: 'east/2024-sales__Data-1.xlsx' },
    { mode: 'newFile', name: 'east/2024-sales__Notes-2.xlsx' }
  ]);
});

test('a mode without a name template has a null name', () => {
  const plan = resolvePlan(transform({}, { output: { mode: 'newSheet' } }), [withSheets('f1', 'a.xlsx', ['Data'])], { now: NOW });
  assert.deepEqual(plan.files[0].actions[0].output, { mode: 'newSheet', name: null });
});

test('an unknown token in the output name or in the query text is a planning error and the plan is still made', () => {
  const recipe = parseRecipe(JSON.stringify({ recipe: 'transform', v: 1, scope: { type: 'sheets', match: 'all' }, query: { source: 'inline', m: 'let S = "{unit.nam}" in S' }, output: { mode: 'newSheet', name: '{date}' } })).recipe;
  const plan = resolvePlan(recipe, [withSheets('f1', 'a.xlsx', ['Data'])], { now: NOW });
  assert.deepEqual(plan.errors, [{ code: 'recipe.token', detail: '{date}' }, { code: 'recipe.token', detail: '{unit.nam}' }]);
  assert.equal(plan.files[0].units.length, 1);
});

test('braces that M uses for lists and record lookups are not tokens', () => {
  const m = 'let A = {1, 2, 3}, B = Source{[Name="x"]}[Content], C = {Source.Name}, D = "{unit.name}{file.name}{file.folder}{unit.index}" in D';
  const recipe = parseRecipe(JSON.stringify({ recipe: 'transform', v: 1, scope: { type: 'sheets', match: 'all' }, query: { source: 'inline', m } })).recipe;
  assert.deepEqual(resolvePlan(recipe, [withSheets('f1', 'a.xlsx', ['Data'])], { now: NOW }).errors, []);
});

test('collect plans do not change: workbook units, null output and pins that do not select units', () => {
  const recipe = collect({ scope: { type: 'sheets', match: 'all' }, output: { mode: 'newFile', name: '{file.name}.xlsx' }, overrides: [{ file: 'a.xlsx', path: 'a.xlsx', units: ['Data'] }] });
  const plan = resolvePlan(recipe, [withSheets('f1', 'a.xlsx', ['Data', 'Notes'])], { now: NOW });
  assert.deepEqual(plan.files[0].units, [{ fileId: 'f1', kind: 'workbook', name: 'a', index: 1 }]);
  assert.equal(plan.files[0].source, 'rule');
  assert.deepEqual(plan.errors, []);
});

test('a transform plan is deterministic, ignores input order, leaves its inputs alone and survives structured clone', () => {
  const files = [withSheets('f2', 'b.xlsx', ['Data', 'Notes']), withSheets('f1', 'a.xlsx', ['Data']), { ...tabled, id: 'f3', relPath: 'c.xlsx', name: 'c.xlsx' }];
  const frozen = JSON.stringify(files);
  const recipe = transform({ match: 'pattern', pattern: 'D*' }, { overrides: [{ file: 'b.xlsx', path: 'b.xlsx', units: ['Notes'] }] });
  const a = resolvePlan(recipe, files, { now: NOW });
  const b = resolvePlan(recipe, [...files].reverse(), { now: NOW });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(files), frozen);
  assert.deepEqual(structuredClone(a), a);
});

test('resolving 500 files with a pattern, hidden sheets and pins takes under 16 ms once warm', () => {
  const files = [];
  for (let i = 0; i < 500; i++) {
    const sheets = [];
    for (let s = 0; s < 8; s++) sheets.push(sheet(s === 0 ? 'Data' : `Sheet${s}`, s, { state: s === 7 ? 'hidden' : 'visible', nonEmpty: s % 2 === 0 }));
    files.push(book(`f${i}`, `folder${i % 20}/file${i}.xlsx`, { sheets, tables: [table(`T${i}`, 'Data')] }));
  }
  const overrides = [];
  for (let i = 0; i < 30; i++) overrides.push({ file: `file${i}.xlsx`, path: `folder${i % 20}/file${i}.xlsx`, units: ['Sheet1'] });
  const recipe = transform({ match: 'pattern', pattern: 'S*', onlyNonEmpty: true, exclude: ['Sheet4'] }, { overrides, output: { mode: 'newSheet', name: '{unit.name}' } });
  for (let i = 0; i < 5; i++) resolvePlan(recipe, files, { now: NOW });
  let best = Infinity;
  for (let i = 0; i < 15; i++) {
    const t0 = performance.now();
    resolvePlan(recipe, files, { now: NOW });
    best = Math.min(best, performance.now() - t0);
  }
  assert.ok(best < 16, `best of 15 runs ${best.toFixed(2)} ms`);
});

test('§3.3 a pin always beats the scope rule, including when the rule would pick other units or none', () => {
  const files = [withSheets('f1', 'a.xlsx', ['Data', 'Notes']), withSheets('f2', 'b.xlsx', ['Notes'])];
  const overrides = [{ file: 'a.xlsx', path: 'a.xlsx', units: ['Notes'] }, { file: 'b.xlsx', path: 'b.xlsx', units: ['Notes'] }];
  const plan = resolvePlan(transform({ match: 'pattern', pattern: 'Data*' }, { overrides }), files, { now: NOW });
  assert.deepEqual([namesOf(plan, 'f1'), plan.files[0].source], [['Notes'], 'pin']);
  assert.deepEqual([namesOf(plan, 'f2'), plan.files[1].skipped], [['Notes'], null]);
});

test('§3.3 an explicit exclude beats an include by pattern or by position and does not promote the next sheet', () => {
  const file = withSheets('f1', 'a.xlsx', ['A', 'B', 'C']);
  assert.deepEqual(namesOf(resolvePlan(transform({ match: 'pattern', pattern: '*', exclude: ['B'] }), [file], { now: NOW })), ['A', 'C']);
  assert.deepEqual(namesOf(resolvePlan(transform({ match: 'position', position: { kind: 'first' }, exclude: ['A'] }), [file], { now: NOW })), []);
  assert.deepEqual(namesOf(resolvePlan(transform({ match: 'position', position: { kind: 'range', from: 1, to: 3 }, exclude: ['a', 'C'] }), [file], { now: NOW })), ['B']);
});

test('§3.3 an exclude is part of the rule, so a pin on the same name still wins', () => {
  const plan = resolvePlan(transform({ exclude: ['Data'] }, { overrides: [{ file: 'a.xlsx', path: 'a.xlsx', units: ['Data'] }] }), [withSheets('f1', 'a.xlsx', ['Data', 'Notes'])], { now: NOW });
  assert.deepEqual(namesOf(plan), ['Data']);
});
