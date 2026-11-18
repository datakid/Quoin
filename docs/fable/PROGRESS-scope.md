# Fable progress: Scope (branch fable-scope)

Started from `fable` at 56b3974. Tasks: F3-01, F3-03, F3-04, then F3-02 for the rules this branch owns.

## Decisions taken at the start

- A3 (the header-row filter applies to tables only) and A2 (a sheet unit is its used range with `Column1…ColumnN`, no header guessed) were taken as "yes", as PARALLEL.md recommends. Both are isolated: A3 in `scope.js` and `recipeErrors` in `resolve.js`; A2 in `snapshot.js`.

## Interface for trunk

- `resolvePlan(recipe, indexes, {now})` is unchanged for callers. It now resolves `collect` and `transform`. `inject`, `replace` and `align` still throw `… recipes are not resolved yet`; `batch-resolve.test.js` still passes unedited.
- New export `inspectNeeds(recipe, indexes)` in `src/batch/resolve/scope.js` (re-exported from `resolve.js`): ids of ready files whose sheets still have `nonEmpty: null` while the recipe filters on non-empty sheets. Trunk sends `inspect` with `need: ['nonEmpty']` for those, replaces their indexes, then calls `resolvePlan`.
- `src/batch/resolve/tokens.js` holds the one token substitution used by resolve (output names) and by `execute/units.js` (query text): `substituteTokens(text, file, unit)`, `unknownQueryTokens(text)`, `templateFor(text)` with `fileContext(file)` (the same substitution, compiled once for many units), `baseName`, `folderOf`. Output naming (F3-05 onward) should import it, not rewrite it.

## Gap found in the split

Resolution for `inject`, `replace` and `align` recipes belongs to nobody on the file-ownership list: `src/batch/resolve/**` is Scope's, but F2-09 ("resolve and execute") is Writer's and F2-02 to F2-08 need actions that only resolve can produce. `resolve.js` now picks its action builder per recipe kind (`planCollectFile`, `planTransformFile`), so adding a kind is one function and one entry in `RESOLVED`. Trunk or the user should say who writes those, and `batch-resolve.test.js` ("only collect is resolved in this phase") must change when they land.

## F3-01 Scope resolution

Layer: resolve
Files: src/batch/resolve/resolve.js, src/batch/resolve/scope.js (new), src/batch/resolve/tokens.js (new), tests/unit/batch-scope.test.js (new)
Do: transform recipes resolve to sheet, table or workbook units per file from the scope rule, then pins; skipped files, orphan pins, summary groups and planning errors as the plan describes.
Test that fails without it: `tests/unit/batch-scope.test.js`, 42 tests; with the old `resolve.js` 39 fail with `transform recipes are not resolved yet` and 3 pass, with the change 42 pass. `batch-resolve.test.js` 14 of 14 pass with and without.
Result: Done
Fails without: yes
Changed expectations: none
Deviations: none

Decisions made inside gaps in the plan:

- A unit's `index` is its 1-based place among the file's resolved units (workbook unit: 1), not the sheet's position in the workbook. `{unit.index}` and run order follow it.
- Candidates are narrowed first by type (worksheets only, `excludeHidden`, `onlyNonEmpty`, `onlyWithHeader`), then the match (`all`, pattern, position) picks from what is left, then `exclude` removes by name without case. So "first" is the first visible non-empty sheet.
- Pins replace the rule for their file and win over `exclude`, hidden and pattern. Pinned units match without case and run in workbook order. Two pins for one file: the later one wins.
- A pin finds its file by exact `name`; if several files share the name it picks by `relPath`; if none matches by name it tries `relPath`. A name shared by several files with no path match is orphaned, never guessed. Collect plans keep `source: 'rule'` and ignore a pin's unit names.
- Pinned unit names that the file does not have go to `orphanPins` as `{file: relPath, units: [missing]}`; a file left with no unit is `skip.noMatchingUnit`.
- `onlyWithHeader` on a sheet scope is the planning error `scope.headerOnSheets` and nothing is filtered (A3). `onlyNonEmpty` on tables means more rows in `ref` than `headerRowCount`; totals rows are not known from the index.
- `onlyNonEmpty` on sheets with an unknown `nonEmpty` keeps the sheet and records `scope.needsInspect` for the file, because dropping unknown sheets would hide data without a trace.
- Action target for a transform: `sheet` for sheet and workbook units, `range` for table units. `output` is `{mode, name}` with tokens filled in per unit and no sanitising or collision suffix yet; `name` is null when the recipe has none.
- Glob patterns are case-insensitive with `*` and `?`, everything else literal. Regex patterns use `RegExp.test` on the name: they match anywhere and are case-sensitive; the author anchors or adds nothing. Regex runs on the main thread over names of at most 255 characters, so a pathological pattern can stall typing; trunk may want to cap or move it.
- Unknown tokens in query text mean only `{file.…}` or `{unit.…}` that are not one of the four tokens. M lists and record lookups such as `{1, 2}` or `{[Name="x"]}` are never tokens.
- `{file.folder}` is the folder part of `relPath` with its trailing slash, `""` at the root, so `{file.folder}{file.name}` joins without a separator.
- Resolving 500 files of 8 sheets with a pattern, pins and output names: the test asserts the best of 15 runs, after 5 warm-up runs, is under 16 ms. Measured here on one shared CPU: best about 1 ms, median about 6 ms, with garbage-collection spikes to 30 ms. A median assertion failed on the first push (17 ms under full-suite load); I pushed that commit with the red test and fixed it in the next commit, so the first push of F3-01 was not green. Output names are compiled once per plan (`templateFor`) and the worksheet list once per file, which cut allocation.

## F3-03 Units in the engine and tokens

Layer: execute and core snapshot
Files: src/core/snapshot.js, src/batch/execute/units.js (new), tests/unit/batch-units.test.js (new)
Do: `buildUnitSnapshot(wb, unit, {base})` adds a sheet unit to the run snapshot as its used range (`Column1…ColumnN`, no header promoted, A2); a table unit is the table already in the snapshot with its headers; a workbook unit adds nothing. `runUnit(wb, file, unit, recipe, {now, base, localOffsetMin})` substitutes tokens as raw text, then parses and runs the query with the recipe's culture and limits, and returns one result per unit.
Test that fails without it: `tests/unit/batch-units.test.js`, 19 tests. The module is missing without the change; with the unit source removed from the snapshot 4 fail, with token substitution removed 6 fail, with the change 19 pass.
Result: Done
Fails without: yes
Changed expectations: none
Deviations: none

Interface (for trunk and Writer): `runUnit` returns `{unit, status: 'ok' | 'error' | 'stopped', m, table, error, flags, durationMs}`. `m` is the substituted query. `table` is an engine `MTable` and stays in the worker; it is not structured-cloneable, so the output writer reads it there. `error` is null or `{code, ...}`:

- `recipe.token` (unknown token, query not run), `unit.parse` (`message`, `line` and `col` inside the substituted query), `unit.error` (`reason`, `message`, `detail` from M), `unit.notTable` (`detail` is the kind M returned), `unit.binding` (the query asked for a file; `detail` is its key), `unit.nameCollision` and `unit.missing` (`detail` is the unit name), and the engine's own stop codes `m.rows`, `m.timeout`, `m.depth` with status `stopped`.
- `buildSnapshot` is untouched. Callers that run many units build one base snapshot per file and pass it as `base`, so tables are read once.

Decisions made inside gaps in the plan:

- A sheet whose name equals a table or workbook name is `unit.nameCollision`. The alternative, letting the sheet shadow the table, would silently change what other names in the same query read. `pq_simple.xlsx` has this case (sheet and table `StudentResults`).
- `now` is required and must be a frozen ISO UTC time, as in `resolvePlan`. `localOffsetMin` is passed through when given; otherwise the engine uses the machine's offset, so a caller that needs identical bytes on every machine passes `0`.
- A transform query must return a table. A scalar, list, record or function is a row error, not a one-cell output.
- A transform query is standalone M: it cannot call the workbook's own queries and cannot read files. A query that calls `File.Contents` or `Web.Contents` is `unit.binding`.

## F3-04 Chained units

Layer: execute
Files: src/batch/execute/units.js, tests/unit/batch-chain.test.js (new), tests/unit/batch-units.test.js (key list gains `outputName`)
Do: `runFileUnits(wb, file, filePlan, recipe, {now, localOffsetMin, isCancelled, onUnit})` runs a file's units in `index` order. A unit may read an earlier unit's output through `Excel.CurrentWorkbook()` by the output name the plan gives that unit. State lives inside one call, so nothing is shared across files. It returns `{runs, cancelled}`.
Test that fails without it: `tests/unit/batch-chain.test.js`, 13 tests. The export is missing without the change; with outputs not registered 4 fail, with the sort by index removed 1 fails, with the change 13 pass.
Result: Done
Fails without: yes
Changed expectations: `batch-units.test.js` is my own F3-03 test; its key list for a run now includes `outputName` (null from `runUnit`, the plan's output name from `runFileUnits`).
Deviations: none

Decisions made inside gaps in the plan:

- The output name is taken from the plan (`action.output.name`, already filled in by resolve), so Preview and run use the same value. No name, no output registered.
- A name resolves to the most recent earlier output with that name. A recipe whose output name has no unit token therefore accumulates: unit 2 reads `Excel.CurrentWorkbook(){[Name="Combined"]}[Content]` and gets unit 1's table. This is the only way one query text can chain, because the four tokens have no arithmetic. It is the reading to confirm with the user.
- Names in the chain are the plan's names. Sanitising and `-2` suffixes for sheet and file names belong to the output step (F3-05 onward) and are not applied here, so a collision suffix added there is not visible to a later unit.
- An earlier output is added to the snapshot as a table whose cells are typed as a written workbook would be read back: dates, times and date-times as date-times, durations as durations, errors as `#VALUE!` or `#NUM!`, anything else as text. Outputs are copied only when a later unit exists.
- An output whose name equals a table, name or sheet unit already in the snapshot makes the next unit a `unit.nameCollision` row error. A failed unit registers nothing; later units still run, and one that needed its output reports the M error.
- `isCancelled` is checked before each unit and `onUnit(run, done, total)` after each, so the worker can send cancel and progress messages. Both are optional.

## F3-02 Precedence

Layer: resolve (test only)
Files: tests/unit/batch-scope.test.js
Do: three tests for the rules of Fable §3.3 that resolve owns: a pin beats the scope rule; an explicit exclude beats an include by pattern or position and does not promote the next sheet; an exclude is part of the rule, so a pin on the same name wins.
Test that fails without it: these pass on arrival because F3-01 built the behaviour. With pins ignored 2 of the 3 fail, with `exclude` ignored 1 fails (the other two exclude cases are the F3-01 tests that fail as well).
Result: Partly done. Rules 3 (two recipes on one field: last chosen wins, the region shows what it replaced) and 4 (injecting an existing name is `replace`, with the old hash) are not in resolve's files: rule 3 is session state in `src/app` and `Action.replaces`, rule 4 is inject resolution and the Writer's execute code. Testing them here would mean writing the code the other branches own, so they stay with trunk and Writer.
Fails without: yes (by mutation)
Changed expectations: none
Deviations: F3-02 was waiting on `quoin-fable.md`; the user attached it to this session and trunk has since added it as `docs/fable/00_FABLE.md` and listed F3-02 as Scope's in PARALLEL.md.

Where each rule of Fable §3.2 and §3.3 is tested in this branch:

- §3.2 pins match by exact name, then folder-relative path: `batch-scope.test.js`, the four "pin" tests on name, path, ambiguity and orphans.
- §3.2 a pin whose file is absent is shown as orphaned and never dropped: "a pin whose file is gone is an orphan".
- §3.2 a file resolving to nothing is skipped, and is not an error: "a file that resolves to nothing is skipped".
- §3.2 divergence is stated as a fact: "divergence is a fact in the summary" (7 files with one unit, 3 files with two, 13 units across 10 files).
- §3.2 order inside a file is the unit order and a unit may read a prior unit's output: `batch-chain.test.js`, "units run in index order" and "a unit reads an earlier unit output".
- §3.3 pin beats rule and exclude beats include: the three tests added in F3-02.

## Strings and codes trunk adds when it merges

Row errors (F3-03): `unit.parse`, `unit.error`, `unit.notTable`, `unit.binding`, `unit.nameCollision`, `unit.missing`, plus `recipe.token` on a row. Existing: `m.rows`, `m.timeout`, `m.depth`.

Planning errors (`plan.errors`): `scope.headerOnSheets` ("The header row filter applies to tables only."), `scope.needsInspect` (the file has not been checked for empty sheets), `scope.pattern` (the name pattern is not valid). Existing: `recipe.token`, `skip.noMatchingUnit`.

## Known failures not caused by this branch

`T-WB-01` (a thousand members index in under 300 ms) and `T-WB-05` (ten thousand items ranked in under 30 ms) are timing tests that fail intermittently in the one-CPU build sandbox, including on `fable` at 56b3974 with none of this branch's code. They were not changed.
