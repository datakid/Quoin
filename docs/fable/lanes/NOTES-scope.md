# Notes: scope

## What changed

- `b01773e` Take in place and Excel compute out of the tree. The tree is `fable` plus the Scope row files. Out: `write-ranges.js`, `styles.js`, `excel-compute.js`, `writeInPlace` and `allowInPlace`, the in-place and compute planning errors in `resolve.js`, `batch-excel-compute.test.js`, `sheet-write.test.js`, `sheet-selfcheck.test.js`, `excel-pack-scope.test.js`, the nine in-place tests in `batch-transform.test.js`, the three in-place planning tests in `batch-scope.test.js`. Back as `fable` has them: `save.js`, `sheet/add-sheets.js`, `grid.js`, `sheet-xml.js`, `sheet-add.test.js`, `fable-worked-example.spec.js`. `batch-inject-tokens.test.js` moved into `batch-tokens.test.js`.
- `63eb47a` Tests for `scope.pattern`, `verify.readBack` (new file and combined) and the line and column text of a `unit.parse` row. This is the last commit that changes code or tests. Later commits change docs only.
- Kept from my branch: D1 (`withInjectTokens`), D3 (`skipped / skip.missingColumn`), `batch-contract.test.js`, `tests/fixtures/generators/worked-example.js`, `batch-worked-example.test.js`, `export/xlsx.js`, `resolve/tokens.js`, `make-excel-pack-scope.mjs`.

## Proved

- Lint 0 findings. Unit: 1751 tests, 1746 pass, 0 fail, 5 skipped, on `63eb47a`. Browser specs not run.
- `node scripts/check-ownership.mjs lane scope origin/fable` flags one file: `src/batch/execute/index.js`, the exception in the brief.
- Every new test was shown to fail without its change (see the audit below).

## Refusal codes for held paths

- `refused.inPlaceHeld`: a recipe with `output.mode: 'inPlace'`. One `refused` row per unit, no output, nothing run.
- `refused.excelComputeHeld`: a recipe with `compute: 'excel'`. Same shape. Checked first, so a compute recipe is never a crash, with or without an `output`.
- `resolvePlan` plans both as ordinary transform actions. The old planning errors `output.rangeRequired`, `output.range`, `output.inPlaceScope`, `output.overlap`, `output.nameRequired` and `output.excelMode` no longer exist.

## For the integrator to apply

1. `src/batch/execute/index.js`, two lines. After `import { executeTransform } from './transform.js';` add `import { withInjectTokens } from '../resolve/tokens.js';`. As the first line of `executeFile`'s body add `  recipe = withInjectTokens(recipe, meta || { name: wb.fileName, relPath: wb.fileName });`. Nothing else in that file differs from `fable`.
2. `tests/unit/outputs.test.js`: nothing to apply. `fable` already has the `xlsx.js` change and the test as it stands.
3. `tests/e2e/fable-worked-example.spec.js`, four lines for D3 (the two units with no `Amount` column are `skipped`, not `failed`):
   - line 23: `'11 would change · 2 refused · 2 failed'` becomes `'11 would change · 2 skipped · 2 refused'`.
   - line 29: `const failed = unitRows.filter((r) => r.verdict === 'failed');` becomes `const skipped = unitRows.filter((r) => r.verdict === 'skipped');`.
   - line 30: `expect(failed.map(` becomes `expect(skipped.map(`. The rest of the line stays.
   - line 53: `expect(verdicts.filter((v) => v === 'failed')).toHaveLength(2);` becomes `expect(verdicts.filter((v) => v === 'skipped')).toHaveLength(2);`.
   Not run here: this spec needs a browser.
4. `scripts/make-excel-pack-scope.mjs` is kept as the brief says. It throws on this tree (`not a verified change`) because all three of its cases need the held paths. Its unit test is deleted. Both come back with the held paths: `git show 30cb00d:tests/unit/excel-pack-scope.test.js`. Delete the script if you would rather not carry a script that cannot run.
5. Safety lane: the F3-11 insertion check reads `49d0ceb` and `tests/unit/sheet-selfcheck.test.js` from `30cb00d` in the history of `fable-scope`.

## Strings (queue item 2)

Codes this tree emits that `src/ui/strings.js` has no text for. Row reasons use the engine's message when there is one; the text below is the fallback. Placeholders are `{detail}`. For `unit.notTable`, `unit.binding`, `unit.nameCollision` and `unit.missing` the row's `reason` is the detail itself (the kind, key or name), and `reasonWords` shows it instead of the string. Call `errorMessage(code, { detail })` for these four if you want the sentence. The word "inspect" in the second line should match the term the app uses.

| Code | Where | Text |
|---|---|---|
| `scope.headerOnSheets` | planning error | Filtering by header row works on tables only, not on sheets. Clear that option or choose tables. |
| `scope.needsInspect` | planning error | Whether a sheet is empty is not known until the file is inspected. Inspect the set, then preview again. |
| `scope.pattern` | planning error | The pattern {detail} is not a valid regular expression. |
| `skip.missingColumn` | skipped row | The query uses a column this table does not have. This unit was skipped and nothing was written for it. |
| `unit.parse` | failed row | The query could not be read. Nothing was written for this unit. |
| `unit.error` | failed row | The query stopped with an error. Nothing was written for this unit. |
| `unit.notTable` | failed row | The query did not give a table. Nothing was written for this unit. |
| `unit.binding` | failed row | The query asks for a file or connection, which a batch cannot give it. Nothing was written for this unit. |
| `unit.nameCollision` | failed row | This sheet has the same name as a table or a name in the workbook. Nothing was written for this unit. |
| `unit.missing` | failed row | This sheet or table is no longer in the file. Preview again. |
| `refused.inPlaceHeld` | refused row | Writing the result in place is not available yet. Nothing was written. |
| `refused.excelComputeHeld` | refused row | Having Excel compute the result is not available yet. Nothing was written. |
| `output.nameTaken` | flag on a run | This output is named like a table in the file, so later units do not see it. |

Already in `strings.js`, no change: `skip.noMatchingUnit`, `skip.notApplicable`, `refused.tooLarge`, `refused.cellTooLong`, `verify.readBack`, `recipe.token`, `recipe.patternAdd`, `align.noSource`, `m.rows`, `m.timeout`, `m.depth`. `unit.missingColumn` lives inside a run result only; the report row says `skip.missingColumn`. Dropped with the removed paths: `output.rangeRequired`, `output.range`, `output.inPlaceScope`, `output.overlap`, `output.nameRequired`, `output.excelMode`, `refused.noSheet`, `refused.empty`, `refused.outOfSheet`, `refused.overlapsTable`, `refused.overlapsMerge`, `refused.overlapsFormula`, `refused.unsupportedSheet`, `refused.rangeTooSmall`, `refused.overlap`, `refused.sheetUnit`, `refused.noName`, `refused.noQuery`, `refused.noLoadTarget`.

## Worked example (queue item 3)

`batch-worked-example.test.js` asserts every number of Fable section 9: 7 pinned files and 3 on all sheets give 13 units across 10 files (`summary` is `{ files: 10, units: 13, groups: [1 unit x 7, 2 units x 3] }`); the run gives 10 workbooks and 13 rows, 11 `changed` all `verified`, 2 `skipped` with `skip.missingColumn` and the engine's message; the two `.xls` files are skipped with `file.unsupportedExtension`; the originals have the same hashes after the run; `branch3.xlsx` gets `Clean` and `Clean-2`.

For `fable-worked-example.spec.js` to match:

- Preview note, second sentence, exactly: `11 would change · 2 skipped · 2 refused`. The first sentence is unchanged: `7 files → 1 unit each, 3 files → 2 units each — 13 units across 10 files`.
- Report: 15 body lines. Verdict counts: 11 `changed`, 2 `skipped`, 2 `refused`, 0 `failed`. The 11 changed rows are `verified` yes. The 2 `skipped` rows carry reason `The column 'Amount' of the table wasn't found.` (the unit the engine names is `South` in the spec's data).
- The 15 lines, not 13, are the 13 unit rows plus one row for each `.xls`. Whether 15 is right is the third difference in your `HANDOVER.md`. No decision D1 to D6 covers it. It still needs the user.

## Audit of resolve and units (queue item 4)

Each emission site was changed on purpose (the code renamed at that one site), the test files that mention the code were run, and the edit was restored. "Fails" names the first failing test. Run on `63eb47a` plus the parse-error test, which was added for the one site that had none.

| Code | Site | Test that fails when it is broken |
|---|---|---|
| `scope.headerOnSheets` | resolve.js:128 | the header row filter does not apply to sheets: it is a planning error and nothing is filtered |
| `scope.needsInspect` | resolve.js:98 | only non-empty on a sheet that was never inspected is a planning error and the sheet is kept |
| `scope.pattern` | scope.js:32 | a regular expression that does not compile is the planning error scope.pattern and no unit matches (new) |
| `recipe.patternAdd` | resolve.js:124 | add never expands: its name is literal, and a pattern on an add is a planning error |
| `recipe.token` | resolve.js:122 | an unknown token in the output name is a planning error naming the token |
| `recipe.token` | resolve.js:123 | a token that is not one of the four in the injected text is a planning error |
| `recipe.token` | resolve.js:127 | an unknown token in the output name or in the query text is a planning error and the plan is still made |
| `recipe.token` | units.js:15 | tokens that are not one of the four are a row error and the query is not run |
| `align.noSource` | resolve.js:125 | align with no file holding the chosen version is a planning error |
| `skip.notApplicable` | resolve.js:42 | a file where a pattern matches nothing is skipped with the pattern as detail and is not counted |
| `skip.noMatchingUnit` | resolve.js:105 | a position beyond the candidates matches nothing and the file is skipped |
| `skip.missingColumn` | transform.js:111 | a unit whose query names a column it does not have is a skipped row |
| `unit.parse` | units.js:29 | a unit that fails is a failed row with its reason and the substituted query |
| `unit.parse` row text | transform.js:26 | a parse error is reported in the row reason with its line and column (new, none before) |
| `unit.error` | units.js:33 | a unit that fails registers no output, the later units still run |
| `unit.missingColumn` | units.js:32 | a query that names a column or field the unit does not have is skipped, with the name |
| `unit.notTable` | units.js:26 | a result that is not a table is a row error |
| `unit.binding` | units.js:38 | a query that asks for a file is a row error because a batch has no files to give it |
| `unit.missing` | snapshot.js:34, 35 | a unit the workbook does not have is an error naming it |
| `unit.nameCollision` | snapshot.js:36 | a sheet that shares its name with a table or a name is an error naming it |
| `m.rows`, `m.timeout`, `m.depth` | units.js:36 (`code: r.code`) | the run limits of the recipe stop a unit and say which limit |
| `output.nameTaken` | units.js:74 | an output named like a table of the workbook is not offered to later units and is flagged |
| `refused.tooLarge` | transform.js:33 | a table with more columns than a sheet holds is refused, not cut |
| `refused.cellTooLong` | transform.js:35 | a cell with more than 32767 characters is refused, not cut |
| `verify.readBack` | transform.js:45 | a new file whose content does not read back as written is not released (new) |
| `verify.readBack` | transform.js:62 | a combined sheet part whose content does not read back as written is not released (new) |
| `verify.readBack` | combine.js:52 | a sheet part that does not read back the way it was made stops the whole workbook |
| `refused.inPlaceHeld` | transform.js:94 | in place is held back until the real-Excel check |
| `refused.excelComputeHeld` | transform.js:94 | a recipe that asks Excel to compute is refused for every unit (new) |

Found on the way: a lone surrogate in a text cell and a negative zero both make the read-back refuse a new file (`not-released / verify.readBack`). That is the check doing its job. The surrogate case is the one the tests use.

## Decisions text for docs/decisions.md (queue item 5)

**D1. Tokens in injected text.** The four tokens `{file.name}`, `{file.folder}`, `{unit.name}` and `{unit.index}` work in the text of an injected query or module, as they do in a transform recipe's query and output name. They do not work in the `with` text of a replace. For an inject the unit is the workbook: `{unit.name}` is the file's name without its extension and `{unit.index}` is 1. A token that is not one of the four is a planning error, `recipe.token`, and nothing is changed. Braces that M and VBA use for lists, records and lookups are left alone.

**D3. A missing column skips the unit.** A unit whose query names a column or field its table does not have is a skipped unit, not a failed one. Row verdict `skipped`, reason code `skip.missingColumn`, and the reason is the engine's message, which names the column, so it is never silent. The other units of the file still land. A query that reads a missing field of a record is treated the same way. The old idea of falling back to inject only is dropped.

**Units.** A scope picks the units of each file: worksheets or tables, or the whole workbook. A pin on a file beats the scope rule for that file. An exclude beats an include by pattern or by position and does not promote the next sheet; a pin on the same name still wins over an exclude. The header-row filter applies to tables only, so using it with a sheet scope is a planning error. A sheet unit is its used range with columns `Column1` to `ColumnN`, no header row is guessed. A table unit is the table.

**Chain.** A file's units run in index order. A unit may read an earlier unit's output through `Excel.CurrentWorkbook()` by the output name the plan gives that unit. Nothing is shared between files. An output named like a table of the workbook is not offered to later units and is flagged `output.nameTaken`.

**Output naming.** New file: the template `{file.name}__{unit.name}.xlsx` unless the recipe gives one; a taken name gets `-2`, `-3` without regard to case, across the whole run. New sheet: each unit adds one sheet to a single copy of its source workbook, named `Result` unless the recipe gives a name; a taken name, including the workbook's own sheet names, gets `-2`, `-3` without regard to case, and a sheet name is at most 31 characters; the copy is named by `suggestedFileName`; units that fail or do not fit a sheet add nothing, and no usable unit means no copy. Combined: one workbook for the whole run, `Combined.xlsx`, with one sheet per unit, named `{file.name}__{unit.name}` unless the recipe gives a name and made unique the same way.

**In place and Excel compute.** Both are held. A recipe that asks for either gets a `refused` row for every unit and nothing is written. In place waits for the real-Excel check X03 to pass in desktop Excel; if it fails it moves to the next version. Excel compute is held with it. Nothing in the tree writes in place or lets Excel run a query on open.

## Open

- The user and real Excel: both packs. Part 2 cannot be built on this tree until the held paths come back.
- The 15-line report (decision 2 of your `HANDOVER.md`) needs the user.
- CI on `63eb47a` (Chromium): 461 browser tests pass, 1 fails, unit 1751 run with 1745 pass, 0 fail and 6 skipped. The one failure is `fable-worked-example.spec.js:9`, which still expects `2 failed`; the four lines under "For the integrator to apply" item 3 fix it. `T-PRIV-1` passes on this tree, so the manifest no longer lacks the removed files.
- The integrator's lines: items 1 and 3 under "For the integrator to apply", and the strings.

HAND BACK 63eb47a

## Mutation check of Scope's files (2026-11-27)

- 218 mutants (comparison, equality, logical and boolean flips) over `resolve/*.js`, `snapshot.js`, `units.js`, `transform.js`, `combine.js`, run against the nine Scope test files. 187 killed, 31 survived. Eleven survivors were real gaps and are killed by new tests in `b35739c`; the new-test mutants were re-run and all die. Unit: 1795 tests, 1790 pass, 0 fail, 5 skipped.
- Left, none worth a test: tie-break comparators (`compare`, `byIndex`, the sort at `scope.js:63`; keys are unique, so `<` and `<=` give the same order), `test: () => true` in `scope.js:27` (never called for a non-pattern scope), the `readsBack` and `readsBackAs` catches that return `false` (our own writer cannot produce bytes that fail to open), `runs.length + 1 < units.length` in `units.js:75` (registering the last unit's output changes nothing, nobody reads it), `flags || []` in `units.js:32,33` (no flags in any fixture), the second `||` of `failureReason`, `localOffsetMin` in `units.js:49` (needs a local-time query; none in the tests), and `.length > 0` for an empty output name in `units.js:59`.
- One thing found on the way is in `MESSAGES-scope.md`: sheet names cut by code points in `names.js` (safety row).

## Milestones (docs/fable/lanes/scope.md)

- S1 `940a3b8` the sheet-write trust gate. `addSheetsToPackage` returns `texts` and `insertions` (part to `{ base, fragments, countElements }`) for `styles.xml`, `workbook.xml`, `workbook.xml.rels` and `[Content_Types].xml`; `selfCheck` takes `partTexts`, `insertions` and `touchedBefore` and requires for each part: the text equals what was written; the text equals the base with only the declared fragments removed (the raw text is searched first, counts of the elements whose count was edited are compared last); each such count equals the number of its children; the base equals the original unless an earlier writer had touched the part. A fragment is a string or `{ from, to }` for the one replacement (an empty `<numFmts count="0"/>`). `verifyAddedSheets` requires the Override of every new sheet. `refuseUnapplied` is as it was; no `write-ranges.js`, `styles.js` or `allowInPlace`.
  - Evidence: `tests/unit/sheet-selfcheck.test.js`, 32 tests: Writer's nine probes T0 to T8 (through `addSheetsToPackage` and `selfCheck`, because `applyChangeSet` checks its own output before it returns and has no seam to tamper between), each also with a writer that expected the damaged text, a count that no longer matches its children, a dropped content type for the new sheet, a declared insertion that was not made while the same text is in the original, a part an earlier writer changed, and the numFmts cases: none, empty, already holding both formats, other formats, one sheet, two sheets, `xw_macro04.xlsm` with one and two sheets.
  - Before and after: Writer's `repro-sheet-gap.mjs` on `origin/fable` accepts all nine tampered outputs; on this branch it rejects all nine. With the old rule (counts stripped first and `numFmts` always counted) the numFmts cases fail with `write.selfcheck: check.part xl/styles.xml`; with the fix they pass.
  - Findings 1, 2 and 5 of `MESSAGES-writer.md` are closed. Findings 3 and 4 (`docProps/app.xml`, no VBA `codeName` on a new sheet in a macro workbook) are for the Excel pack and are not changed.
  - UTF-16: `names.js` cuts a sheet name to 31 UTF-16 units without splitting a character, also for the `-2` suffix. `sheetNameBase` of 40 emoji is 15 emoji (30 units) and the second 40-emoji name is 14 emoji and `-2`. The two tests in `batch-naming.test.js` that asserted the old code point cut ("cut to 31 code points" and the emoji case of the suffix test) now assert the unit cut; that is the one expectation change, named in S1. `batch-combined.test.js` has the emoji test for the combined workbook. The cut is the safe direction whichever way Excel counts; a pack case with a 16-emoji sheet name would show which.
  - Mutation proof: 105 mutants (comparison, equality, logical, boolean flips) over `save.js`, `add-sheets.js` and `names.js`: every mutant in the new code is killed; the 8 survivors are in code that was already there (`changedVbaEdits` lookup and defaults, the refresh default, `buildWorkbook` defaults). 13 further breaks of the string-level parts (`COUNT_CHILD` entries, the `{ from, to }` replacement, the `touchedBefore` check, the content type check, the numFmts branches, `takeUnits`) are all killed. Unit 1828 tests, 1822 pass, 0 fail, 5 skipped; lint 0; `check-ownership` prints `scope: 11 changed files, all owned`.


HAND BACK 63eb47a
