# Fable progress: Scope (branch fable-scope)

Started from `fable` at 56b3974. Tasks: F3-01, F3-03, F3-04, then F3-02 for the rules this branch owns.

## Decisions taken at the start

- A3 (the header-row filter applies to tables only) and A2 (a sheet unit is its used range with `Column1…ColumnN`, no header guessed) were taken as "yes", as PARALLEL.md recommends. Both are isolated: A3 in `scope.js` and `recipeErrors` in `resolve.js`; A2 in `snapshot.js`.

## Interface for trunk

- `resolvePlan(recipe, indexes, {now})` is unchanged for callers. It now resolves all five recipe kinds (`collect`, `inject`, `replace`, `transform`, `align`); an unknown kind still throws `… recipes are not resolved yet`. `batch-resolve.test.js` needed one test changed, which is explained under the resolve side of replace and align.
- New export `inspectNeeds(recipe, indexes)` in `src/batch/resolve/scope.js` (re-exported from `resolve.js`): ids of ready files whose sheets still have `nonEmpty: null` while the recipe filters on non-empty sheets. Trunk sends `inspect` with `need: ['nonEmpty']` for those, replaces their indexes, then calls `resolvePlan`.
- `src/batch/resolve/tokens.js` holds the one token substitution used by resolve (output names) and by `execute/units.js` (query text): `substituteTokens(text, file, unit)`, `unknownQueryTokens(text)`, `templateFor(text)` with `fileContext(file)` (the same substitution, compiled once for many units), `baseName`, `folderOf`. Output naming (F3-05 onward) should import it, not rewrite it.

## Gap found in the split (now closed)

Resolution for `inject`, `replace` and `align` recipes belonged to nobody on the file-ownership list: `src/batch/resolve/**` is Scope's, but F2-09 says "resolve and execute" and Writer cannot edit resolve. Scope took it with the user's go-ahead; see the next section. `resolve.js` picks its planner per recipe kind (`planCollectFile`, `planTransformFile`, `planInjectFile`, `planReplaceFile`, `planAlignFile`).

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

## Resolve side of the inject recipe (taken from the gap above)

Layer: resolve
Files: src/batch/resolve/resolve.js, tests/unit/batch-resolve-inject.test.js (new)
Do: `resolvePlan` now resolves `inject` recipes, which closes the `inject` half of the gap. Each file gets one workbook unit and one action per target: `op` is the recipe's `add`, `replace`, `rename` or `remove`, and `target` is `{type: 'query' | 'module', name}`. A recipe with `match: 'name'` gets its action in every file, whether or not the file has the target, because Writer's `executeFile` reports a missing target as `skipped / skip.notApplicable`. `match: 'pattern'` expands the glob over the queries or modules the file has, in file order and without regard to case; a file where it matches nothing is skipped with `skip.notApplicable` and the pattern as detail, with no units. 
Test that fails without it: `batch-resolve-inject.test.js`, 13 tests. 12 fail with `inject recipes are not resolved yet`; with pattern expansion removed 3 fail; with the change 13 pass.
End-to-end check, not committed: a plan resolved here run through Writer's `executeFile` (`fable-writer` at 8c0fd6a) on `pq_simple.xlsx`. `replace` by name and by pattern and `add` gave `changed`, verified, with bytes; `replace` of a missing query gave `skipped / skip.notApplicable` and no bytes.
Result: Done
Fails without: yes
Changed expectations: none (`batch-resolve.test.js` uses `align` as its unresolved example, so it still passes)
Deviations: none

Decisions made inside gaps in the plan:

- `add` never expands. A pattern on an `add` is the planning error `recipe.patternAdd`, and the action still carries the literal name.
- `newName` for a rename, `text` and `refreshOnLoad` stay in the recipe. Actions carry no text, as Writer's `executeFile` already assumes.
- `replace` and `align` recipes are resolved in the next section.

New strings for trunk: planning error `recipe.patternAdd`; skip reason `skip.notApplicable` for a file where a pattern matched nothing (Writer already uses the code for a missing target).

## Resolve side of replace-in-code and align (F2-08, F2-09)

Layer: resolve
Files: src/batch/resolve/resolve.js, src/batch/resolve/align-source.js (new), tests/unit/batch-resolve-inject.test.js, tests/unit/batch-scope.test.js and tests/unit/batch-resolve.test.js (one test changed each)
Do: `replace` recipes give one `replaceText` action per query (if `in` has `m`) and per module (if `in` has `vba`), queries first. `align` recipes give one `align` action per file that has the target, whether or not its hash already matches; a file without it is skipped with `skip.notApplicable`. A file with nothing for either recipe to act on is skipped the same way, with no units. `alignSourceFor(recipe.align, indexes)` returns `{fileId, relPath, name}` of the first ready file in plan order that has the name with the chosen hash, or null; a plan with no such file carries the planning error `align.noSource` and still lists the actions.
Test that fails without it: `batch-resolve-inject.test.js`, 24 tests; 7 failed with `replace recipes are not resolved yet` or `align recipes are not resolved yet` before the change and the 4 `alignSourceFor` tests failed on the missing module. 24 pass.
End-to-end check, not committed: plans from here run through Writer's `executeFile` at cc32a93 on `pq_simple.xlsx` and `pq_vba_complex.xlsm`. Replace in M and VBA changed and verified one query and one module (34044 bytes written); replace in M only changed and verified `StudentResults`; align rewrote `StudentResults` to the chosen text, changed and verified, and skipped the file without it.
Result: Done
Fails without: yes
Changed expectations: `tests/unit/batch-resolve.test.js` is trunk's file. Its test "only collect is resolved in this phase" used `align` as the unresolved example, which no longer holds, so it is now "a recipe of a kind that is not known is not resolved" with a made-up kind. Same for my own `batch-scope.test.js`.
Deviations: I first wrote execute modules for F2-08 and F2-09 (`replace.js`, `align.js`) while Writer was on its limit. Writer came back and built both in `changes.js` and its own `replace.js` before I pushed, so I dropped mine unpushed and kept only the resolve side. Nothing of mine in the execute layer touches Writer's files.

Decisions made inside gaps in the plan:

- `replaceText` is per member, as Writer's `replaceText` already assumes. Writer reports a member with no match as `unchanged`, so a workbook with 100 queries shows 100 rows per file for a replace that touches none. Trunk should decide whether Preview and the report hide `unchanged` rows by default.
- The text of an align version is not in the plan. Trunk reads it from the file `alignSourceFor` names and passes it to `executeFile` as `alignText`, which Writer's code already accepts.
- Tokens such as `{file.name}` are substituted in transform queries only. They are not substituted in inject text or in the replace `with`, anywhere. Fable §3.5 says recipes take tokens; whether these two fields should is a question for the user.

New strings for trunk: planning error `align.noSource` ("No file in the set has this version of the query or module.").

## F3-05 Output: new file per unit

Layer: execute and core export
Files: src/core/sheet/names.js (new), src/batch/execute/transform.js (new), src/batch/execute/units.js (exports `tableCells`), src/batch/resolve/resolve.js (default name), tests/unit/batch-naming.test.js, tests/unit/batch-transform.test.js (new). Edits to files owned by others, each small: `src/core/export/xlsx.js` (trunk: exports `MAX_ROWS` and `MAX_COLS`, takes `{now}` for a frozen zip clock, and writes a carriage return as `&#13;`); `src/batch/execute/index.js` (Writer: `executeFile` hands a transform recipe to `executeTransform`, one line plus the import).
Do: `executeTransform(wb, filePlan, recipe, {now, meta, runId})` runs the units, writes each result as a values-only `.xlsx` with one sheet `Result`, reads the bytes back through the workbook reader and compares every cell before it releases the file, and returns `{fileId, outputs, rows, failures, warnings}`. `outputs` is `[{unit, name, bytes, sha256}]` and `name` is the plan's filled-in template, not yet unique across files; trunk applies `NameBook.file` over the whole run when it builds the zip, because workers cannot see each other. One report row per unit: `changed` with the output name, hash and `verified: true`; `failed` with the unit's error code and its text; `refused.tooLarge` for more than 16384 columns or 1048575 rows; `refused.cellTooLong` for a cell over 32767 characters; `not-released / verify.readBack` if the file does not read back equal. `failures` carries each failed unit's substituted query for the UI. A recipe without a name template gets `{file.name}__{unit.name}.xlsx`.
Test that fails without it: `batch-transform.test.js` (14 tests) and `batch-naming.test.js` (11) fail on a missing module; with the change all pass. A bug found by writing the tests: a carriage return in a cell was written raw, so a conforming XML reader turns it into a line feed and our own reader did not, which hid it from the read-back; it is now written as `&#13;`.
Checked outside Quoin: a typed result (date, date-time, time, duration, logical, number, text with `&` and `<`, null, error, CR LF, leading and trailing spaces) opens in openpyxl and in LibreOffice headless with the right values, types and formats.
Result: Done locally; the real-Excel pack item is pending (open `new file per unit` output in Excel, no repair prompt, values and formats as expected).
Fails without: yes
Changed expectations: none
Deviations: merged `fable-writer` into `fable-scope` (see MESSAGES-scope.md): `executeTransform` needs Writer's `reportRow` and `executeFile`, and later cards need `applyChangeSet`.

Decisions made inside gaps in the plan:

- The sheet in a new file is called `Result` (the name `tableToXlsx` already uses), whatever the unit is called.
- Names of new files are not made unique inside a worker. Worker outputs carry the plan's names and the main thread runs them through one `NameBook` for the whole zip.
- Output is refused, never cut, when it would not fit a sheet.

## F3-06 Output: new sheet

Layer: core sheet, save and execute
Files: src/core/sheet/add-sheets.js, sheet-xml.js, grid.js (new), src/core/export/limits.js (new), src/batch/execute/transform.js, src/batch/resolve/resolve.js (default sheet name `Result`), tests/unit/sheet-add.test.js (new, 15 tests), tests/unit/batch-transform.test.js (9 more). Edits to files owned by others: `src/core/save.js` (Writer: `refuseUnapplied` now refuses only `sheets.write`; `applyChangeSet` calls `addSheetsToPackage`; `selfCheck` calls `verifyAddedSheets`; three small hunks) and `src/core/export/xlsx.js` (trunk: `tableToXlsx` now builds its sheet with the shared `sheetXml`, output bytes unchanged), `src/batch/execute/index.js` (Writer: passes `apply` to the transform step).
Do: `ChangeSet.sheets.add` is `[{name, table, culture}]`. `addSheetsToPackage` adds `xl/worksheets/sheetN.xml` (next free N), one `<sheet>` at the end of `<sheets>` with the next free `sheetId` and `rIdN`, one relationship, one content-type override, and appends five cell styles (date, date-time, time, duration, bold header) to the workbook's own `styles.xml`, reusing number formats it already has. Every other part is byte-identical, and `selfCheck` enforces that. Inline strings are used, so `sharedStrings.xml` is untouched. After the write, `verifyAddedSheets` re-opens the file and compares the sheet list and every cell of each new sheet with the table. In `executeTransform`, `output.mode: 'newSheet'` adds one sheet per unit to a single copy of the source workbook, named by the plan's template (default `Result`) through `NameBook` seeded with the workbook's sheet names (`Result`, `Result-2`, case-insensitive, 31 code points); the copy is named by `suggestedFileName`; one report row per unit, `output` is `<copy name> [<sheet name>]`, all rows share the file hash. Units that fail or do not fit a sheet add nothing; no usable unit means no copy.
Test that fails without it: `sheet-add.test.js` fails on a missing module and the nine new-sheet tests in `batch-transform.test.js` fail with `newSheet output is not supported yet`; with the sheet comparison removed from the check 1 fails, with the relationship prefix fixed to `r:` 1 fails; with the change all pass.
Checked outside Quoin: a typed sheet added to each of the 9 fixture workbooks (5 macro workbooks, `xlsxwriter` files and a Microsoft template) opens in openpyxl with the right values, types and formats and converts in LibreOffice without error.
Result: Done locally; the real-Excel pack item is pending (open the copy in Excel: no repair prompt, new sheet last, date formats right, macros still run, Power Query still refreshes).
Fails without: yes
Changed expectations: `batch-chain.test.js` is my own: its "no output name" case now uses `combined`, because `newSheet` has a default name.
Deviations: none beyond the edits listed.

Decisions made inside gaps in the plan:

- The new sheet is always last, never selected, with a bold header and no column widths.
- `docProps/app.xml` is left as it was. Its sheet-name list is metadata and goes out of date; this is the likeliest thing for the real-Excel pack to catch.
- A styles part that cannot take new entries (no `fonts` or `cellXfs`, or prefixed names) fails the file as `check.part`; none of the 9 fixtures does.
- Names are made valid and unique by the caller; `addSheetsToPackage` throws a `TypeError` for a bad or repeated name, because that is a bug and not a user condition.

## F3-07 Output: combined

Layer: core export, execute
Files: src/core/export/xlsx.js (trunk's: `workbookFromSheets`, `tablesToXlsx` takes `[{name, table}]`, one-sheet bytes unchanged, checked by hash), src/core/sheet/grid.js (`normalisedRows`, a stricter `sameGrid`), src/batch/execute/combine.js (new), src/batch/execute/transform.js, src/batch/execute/units.js (chain fix below), src/batch/resolve/resolve.js (default name `{file.name}__{unit.name}`), tests/unit/batch-combined.test.js (new, 11 tests), tests/unit/outputs.test.js (trunk's: its "rejects many tables" assertion is now "one sheet each", named in the test title), tests/unit/batch-chain.test.js.
Do: combined is one output workbook for the whole run, one sheet per unit. Workers cannot see each other, so `executeFile` for a combined recipe returns no workbook: it returns `sheetParts: [{unit, name, xml, digest, rowIndex, columns, rows}]` (plain data, structured-cloneable) after checking each part alone in a one-sheet workbook, and rows with verdict `changed`, `verified: true` and an empty `output`. Once every file is done the main thread calls `combineOutputs(results, {now, name})` with the results in plan order. It makes the sheet names unique across the run with `NameBook`, writes `Combined.xlsx`, re-opens it and compares each sheet's cells with the digest the worker made, and returns `{bytes, sha256, name, sheetNames, results}` where `results` carry rows patched with `output: "Combined.xlsx [Sheet]"`, the file hash and `verified`. A part that does not read back, or any other failure, makes every part's row `not-released / verify.readBack` and gives no workbook. No usable part gives `bytes: null`. `tablesToXlsx` takes many tables with the same naming rules.
Test that fails without it: `batch-combined.test.js` fails on a missing module; with the change all 11 pass.
Checked outside Quoin: a combined workbook of four sheets from three files opens in openpyxl with the right dimensions and headers and converts in LibreOffice.
Result: Done locally; the real-Excel pack item is pending (open `Combined.xlsx`: no repair prompt, sheet order and names, dates right).
Fails without: yes
Changed expectations: `outputs.test.js` (trunk's) as above; `batch-scope.test.js` and `batch-chain.test.js` are mine.
Deviations: none.

A bug in my own F3-04 found by these tests and fixed here: an output named like a table in the workbook, which is what the template `{unit.name}` always gives for table units, made the next unit fail with `unit.nameCollision`. The output is now not offered to later units and the run carries the flag `output.nameTaken`; a unit that actually has to read by that name gets the workbook's own table, so a recipe that chains should choose a name the workbook does not use. The collision error stays for a sheet unit whose name equals an earlier output.

Decisions made inside gaps in the plan:

- The sheet-name default for combined is `{file.name}__{unit.name}`, cut to 31 code points, so a long file name can swallow the unit name; the author can set a template.
- The combined workbook is called `Combined.xlsx`. Its rows are patched after the run, so a progress display should treat `output` as empty until `combineOutputs` has run.
- `sameGrid` now ignores trailing empty rows and cells and fails on extra cells, so a table whose last row is all empty reads back equal and an extra cell no longer slips through.

## F3-08 Output: in place

Layer: core sheet, save, execute, resolve
Files: src/core/sheet/write-ranges.js, styles.js (new; `appendStyles` moved out of add-sheets.js), src/core/sheet/sheet-xml.js (`tableCellRows`, bytes of the one-sheet file unchanged, checked by hash), src/batch/execute/transform.js, src/batch/resolve/resolve.js, tests/unit/sheet-write.test.js (new, 16), tests/unit/batch-transform.test.js (+9), tests/unit/batch-scope.test.js (+3). Edits to others' files: `src/core/save.js` (Writer's: `refuseUnapplied` is gone because both sheet operations are now applied; `applyChangeSet` calls `writeRangesToPackage`; `selfCheck` calls `verifyWrittenRanges`).
Do: opt-in (the recipe has to say `inPlace` and give `range`). `ChangeSet.sheets.write` is `[{sheet, anchor: {row, col}, table, culture}]`. `writeRangesToPackage` splices the header row and the table into the sheet's own XML: existing rows keep their attributes except `spans` (dropped on rows it touches), existing cells outside the range are copied through as the exact original text, new rows are inserted in order, `<sheetData/>` is expanded if empty, and `<dimension>` grows to cover the range. The cells use inline strings and the five styles appended to the workbook's styles. After the write `verifyWrittenRanges` re-opens the copy and checks every cell of each range against the table and every cell outside the ranges against the original. `refuseReason` refuses before anything is written, per unit: `refused.noSheet`, `refused.empty`, `refused.outOfSheet`, `refused.overlapsTable` (any table on the sheet), `refused.overlapsMerge` (a merged range), `refused.overlapsFormula` (a cell with a formula in the range), `refused.unsupportedSheet` (a row or cell without its position, or a prefixed `sheetData`). In `executeTransform` a unit's sheet is its own sheet (sheet unit) or the sheet of its table (table unit); `output.range` is a cell, or a rectangle that is a limit (`refused.rangeTooSmall` if the result does not fit, nothing written outside it); two units that would overlap on one sheet give `refused.overlap` for the later one; the copy is named like New sheet, `output` is `<copy> [Sheet!E1:F4]`. Resolve adds planning errors for Preview: `output.rangeRequired`, `output.range`, `output.inPlaceScope` and `output.overlap` (two units on one sheet with the same range).
Test that fails without it: `sheet-write.test.js` fails on a missing module and the nine in-place tests in `batch-transform.test.js` fail with `inPlace output is not supported yet`; with the formula check, the spans removal, the row ordering or the outside-the-range check removed one test each fails; with the change all pass.
Checked outside Quoin: a typed range written into the first sheet of each of the 9 fixture workbooks, at two anchors (18 files): openpyxl reads all of them, every original cell of the sheet is unchanged, the new cells are typed (date, date-time, duration) and LibreOffice converts all 18.
Result: Done locally; the real-Excel pack item is pending (open the copy in Excel: no repair prompt, the old cells and formulas on the sheet unchanged, the new range right, pivot tables and charts on the sheet still fine).
Fails without: yes
Changed expectations: `sheet-add.test.js` (mine) lost its "sheet writes are still not applied" test.
Deviations: none beyond the edits listed.

Decisions made inside gaps in the plan:

- `range` is required; there is no default. It is relative to each unit's own sheet, so a sheet scope with `E1` writes `E1` on every sheet.
- Values already in the range are replaced without a warning, because the recipe is explicit and the mode is labelled. Formulas, tables and merged ranges are never replaced.
- Data validation, conditional formatting, hyperlinks and comments that sit on cells of the range are left as they are; the pack should look at one sheet that has them.
- The copy's own sheet-level parts (drawings, pivot caches, `tableParts`) are never touched.

## For trunk when merging

- `asset-manifest.json` is not committed here, so CI on this branch shows one browser failure: `T-PRIV-1` finds `/src/batch/resolve/tokens.js` loaded but not listed (resolve.js now imports it, and `scope.js`). Everything else on CI at 4e3517a is green: unit 1202 pass, 0 fail; browser 281 pass, 1 fail; 0 visual. Running `npm run build` on the merge adds `src/batch/execute/units.js`, `src/batch/resolve/scope.js`, `src/batch/resolve/tokens.js` and `src/batch/resolve/align-source.js`.
- Files this branch changes: `src/batch/resolve/{resolve,scope,tokens}.js`, `src/batch/execute/units.js`, `src/core/snapshot.js`, three new test files, this progress file. It touches no file outside the Scope list. The merge of `fable` at e86d5e4 was clean.
- Nothing in `src/app`, `src/workers` or `collect.js` calls the new code yet. Wiring is yours: call `inspectNeeds` then `resolvePlan`; in the worker call `runFileUnits` with the file's `{name, relPath}`, the file plan and the recipe, and hand each `run.table` to the output writer there.
- Decisions to confirm with the user, because they change what people see: `{unit.index}` is the ordinal among resolved units; a name resolves to the latest earlier output, so a constant output name accumulates (chain); a sheet named like a table is `unit.nameCollision`; `{file.folder}` keeps its trailing slash.
- Wiring for the new resolve output: after `resolvePlan` on an align recipe, call `alignSourceFor`, read that member's original text from the named file and pass it as `alignText` to `executeFile` for every file in the plan.

## Known failures not caused by this branch

`T-WB-01` (a thousand members index in under 300 ms) and `T-WB-05` (ten thousand items ranked in under 30 ms) are timing tests that fail intermittently in the one-CPU build sandbox, including on `fable` at 56b3974 with none of this branch's code. They were not changed.
