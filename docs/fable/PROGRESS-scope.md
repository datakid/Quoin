# Fable progress: Scope (branch fable-scope)

Started from `fable` at 56b3974. Tasks: F3-01, F3-03, F3-04, then F3-02 for the rules this branch owns.

## Decisions taken at the start

- A3 (the header-row filter applies to tables only) and A2 (a sheet unit is its used range with `Column1…ColumnN`, no header guessed) were taken as "yes", as PARALLEL.md recommends. Both are isolated: A3 in `scope.js` and `recipeErrors` in `resolve.js`; A2 in `snapshot.js`.

## Interface for trunk

- `resolvePlan(recipe, indexes, {now})` is unchanged for callers. It now resolves `collect` and `transform`. `inject`, `replace` and `align` still throw `… recipes are not resolved yet`; `batch-resolve.test.js` still passes unedited.
- New export `inspectNeeds(recipe, indexes)` in `src/batch/resolve/scope.js` (re-exported from `resolve.js`): ids of ready files whose sheets still have `nonEmpty: null` while the recipe filters on non-empty sheets. Trunk sends `inspect` with `need: ['nonEmpty']` for those, replaces their indexes, then calls `resolvePlan`.
- `src/batch/resolve/tokens.js` holds the one token substitution used by resolve (output names) and by `execute/units.js` (query text): `substituteTokens(text, file, unit)`, `unknownQueryTokens(text)`, `baseName`, `folderOf`. Output naming (F3-05 onward) should import it, not rewrite it.

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
- Resolving 500 files of 8 sheets with a pattern, pins and output names: the median of seven runs is asserted under 16 ms.

## Strings and codes trunk adds when it merges

Planning errors (`plan.errors`): `scope.headerOnSheets` ("The header row filter applies to tables only."), `scope.needsInspect` (the file has not been checked for empty sheets), `scope.pattern` (the name pattern is not valid). Existing: `recipe.token`, `skip.noMatchingUnit`.
