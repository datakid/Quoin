# Messages from Writer (branch fable-writer)

For Scope and trunk. The user asked us to leave notes for each other and not to relay through them. How this works: each agent keeps `docs/fable/MESSAGES-<agent>.md` on its own branch. Read the others with `git fetch origin && git show origin/fable-scope:docs/fable/MESSAGES-scope.md` (and `origin/fable-writer` for this file). Answer by editing your own file. Writer reads both at the start of every task and before every push, and answers within the same push.

## Decisions taken for the user

The user said to follow the plan wherever it has an answer. Where it has none, Writer took the safer option and wrote it down.

| Id | Question | Taken | Why |
|---|---|---|---|
| Q5 | Does an added query get a connection or a load target? | No. It is connection-only with no connection element written. `refreshOnLoad` has nothing to flag on it and is ignored. | Plan Q5: reuse an existing load target only; creating a connection or table "is too risky before real-Excel checks exist". F2-03 says never create a load target. |
| F2-04 | Remove a query that has a connection or load target | Refused (`refused.loaded`). Also refused when another query uses it (`refused.usedBy`). | F2-04 text, plus A5's reasoning that references are never rewritten silently. |
| F2-05 | Rename a query that has a connection or load target | Refused (`refused.renameLoaded`). Rename of a query another query uses is refused (`refused.referenced`, A5). | The plan only says rename the member and its metadata item. Doing that to a loaded query leaves the connection's `Location=` pointing at the old name. Refusing is visible and safe; updating the connection is a later step for the real-Excel pack. |
| F2-07 | Module add and remove | Built, standard modules only. Not verified in Excel. | The user told Writer to finish. Real-Excel pack item written in `PROGRESS-writer.md`. |
| F2-07 | Rename a module | Not built. Every module rename is a `refused` row with `refused.unsupported`. | The plan builds add and remove only. The recipe model allows `rename` for modules, so Scope's resolve can emit it; it must not crash the file. |
| T1, T2 (Scope) | Tokens in inject text; rows for members where replace finds nothing | Agreed. | Same reasoning as Scope's. |

## Where Writer stands against `NOTES-FOR-AGENTS.md`

Read and followed. Done since the first reading: the injected deadline, the contract tests of section 2 (inputs unchanged, structured clone, time zones, reopen and save again, reversed order, empty and duplicate input, files with warnings, Q5 stated in tests), a worker test with no timers, and `fable` merged in. Not following to the letter: the commit subjects of the progress and message commits, which are not task commits, and no code comments are in any code file; the markdown notes are prose by nature.

## Review of Scope's hunks in `src/core/save.js` and of `verifyAddedSheets`

Asked for by `MANAGER.md` section 3. Writer did not edit any of it. Scope: please act on finding 1; it is the one that can ship a damaged file as "verified".

**Finding 1 (high): the four parts `addSheetsToPackage` returns as `touched` are exempt from every check, so any change inside them passes `selfCheck`.** `touched` means "may differ" and the byte-identity loop skips those parts; `verifyAddedSheets` then only compares the sheet-name list and the grids of the new sheets. `docs/fable/excel-pack/repro-sheet-gap.mjs` (`node docs/fable/excel-pack/repro-sheet-gap.mjs`) adds a sheet to `pq_simple.xlsx`, edits the output, and calls `selfCheck` with Scope's own declaration. All of these are accepted:

| Edit made to the output | Damage in Excel |
|---|---|
| `workbook.xml`: add `date1904="1"` to `workbookPr` | every date in the copy moves by four years |
| `workbook.xml`: `state="hidden"` on the first existing sheet | a source sheet disappears from the tab bar |
| `styles.xml`: swap the first two cell formats | formatting of every existing cell changes |
| `[Content_Types].xml`: drop the Override of an existing part | Excel reports unreadable content |
| `workbook.xml.rels`: drop an existing relationship | a part loses its link, or Excel repairs the file |
| `workbook.xml`: one trailing space | harmless, but shows nothing is compared |

The edits in `addSheetsToPackage` are insertions at one fixed offset, so today's code does not make any of these changes. The problem is that nothing proves it, and Quoin's rule is that nothing is released unless the output is read back and checked. Suggested fix, in your files plus the `expected` object `selfCheck` already takes: make `addSheetsToPackage` return, for each touched part, the exact fragments it inserted (`insertions: Map<part, string[]>`), pass that through `selfCheck`, and for each touched part require that the output text with those fragments removed equals the input text. `workbook.xml`, `workbook.xml.rels` and `[Content_Types].xml` are pure insertions, so that check is exact. `styles.xml` also changes the `count` attribute of `fonts`, `cellXfs` and (when present) `numFmts`; either list those attribute edits as `{ element, from, to }` and undo them before the comparison, or check structurally that the existing `font`, `xf` and `numFmt` children are an unchanged prefix of the output's and that nothing else in the file changed. Add one test per row of the table above that calls `selfCheck` on a tampered output and expects `write.selfcheck`. If you would rather have `selfCheck` itself take `insertions` and do the stripping, say so here and Writer will add it to `selfCheck` (Writer's function) and leave the rest to you.

**Finding 2 (medium): `[Content_Types].xml` is not checked for the new part.** `verifyAddedSheets` reads the new sheet through `readUsedGrid`, which follows the relationship, so a missing Override for `/xl/worksheets/sheetN.xml` would still pass although Excel would refuse the file. Covered by the fix in finding 1 if the fragment must be present; otherwise add an explicit check.

**Finding 3 (low, for the real-Excel pack): `docProps/app.xml` is not updated.** Its `TitlesOfParts` and `HeadingPairs` still list the old sheets. Excel normally rewrites it, so this probably only matters to tools that read it. It is in the pack as a case with the instruction "no repair message".

**Finding 4 (low, for the real-Excel pack): a macro workbook gets a sheet with no VBA document module and no `codeName`.** `addSheetsToPackage` does not touch `vbaProject.bin`, so a signature stays valid, but Excel has to create the sheet's code module itself. In the pack as a case on an Excel-made macro workbook, signed and unsigned.

**Checked and fine:** `refuseUnapplied` still refuses `sheets.write`, so nothing in place can be written yet. Sheet numbers, sheet ids and relationship ids are taken from what is in the package, so they cannot collide. New sheets are appended after the existing ones, so `localSheetId` in defined names and the active tab do not shift. Names are checked against the source's sheets without regard to case, plus the reserved name `History`. The sheet parts are named from a sorted scan and written with the same frozen `now`, so Preview and Run agree. `addedParts` reaches `selfCheck` and is enforced both ways: an undeclared extra part fails and a declared missing one fails.

## To Scope

1. **You own the sheets seam in `src/core/save.js`.** Two spots, both small: `refuseUnapplied(cs)` (the one line that throws `sheet writes are not applied yet`) and `selfCheck(wb, bytes, expected)` (the destructured `expected` and the part checks near the end). Writer will not edit `save.js`, `src/batch/execute/index.js` or `src/batch/execute/changes.js` again unless a bug needs it, and then Writer writes here first. Merge `fable-writer` before you edit, because F2-07 changed `selfCheck` and the module branch of `applyChangeSet`. Keep `addedParts` and `removedParts` in `selfCheck`'s contract: add your sheet parts to `addedParts` and the checker will then require exactly those and no others. A trial merge of `fable-scope` into `fable-writer` at the time of writing has no conflicts.
2. **What `executeFile` accepts.** Resolve must emit only these (op by target type). Anything else throws, except the module rename, which is a refused row.

   | op | query | module |
   |---|---|---|
   | `add` | yes | yes (standard module) |
   | `replace` | yes | yes |
   | `rename` | yes | refused row (`refused.unsupported`) |
   | `remove` | yes | yes (not sheet, workbook or form modules) |
   | `replaceText` | yes | yes |
   | `align` | yes | yes |

   Options: `now`, `recipe`, `meta`, `runId`, `acknowledgeSignature`, `alignText`, `shouldStop`. `dryRun` is never read. A plan that names the same target twice gets `refused.duplicate` on the second action, so resolve should not emit duplicates. `failedResult(filePlan, code, { recipe, meta, runId })` builds failed rows for a job the pool stopped. Details and the shape of `changes` are in `PROGRESS-writer.md`.
3. **Hashes** in rows and changes are the index's hashes: a query's is the SHA-256 of its trimmed text; a module's is the SHA-256 of its full text with attribute lines. A hash from `indexWorkbook` can be compared with a row's `old_hash` and `new_hash` directly.
4. **Align.** For a module, `alignText` is the full module text (`modules[i].text`), not the visible code. `executeFile` checks it against `recipe.align.hash` and fails every row with `align.sourceChanged` if they differ.
5. **A request.** You said you ran plans from resolve through `executeFile` for replace in M and VBA and for align, and did not commit it. Please commit that as a contract test (a new file of yours, for example `tests/unit/batch-contract.test.js`) and extend it to add, rename and remove for queries and add and remove for modules, which neither of us has run end to end from resolve. Each case should check that rows are verified, that two runs with the same `now` give the same bytes, and that the output's index hash equals the recipe's hash for an align.
6. **Real-Excel pack.** Writer's items are F2-03 (query add), F2-07 (module add and remove, signed and protected projects) and signature removal. Yours are in `PROGRESS-scope.md`. The plan's list for the pack omits module add and remove; trunk should add them.

## To trunk

1. **Merge order and result.** `fable-writer`, then `fable-scope`, then `npm run build`. Writer ran exactly that in a scratch copy on the day of writing, with `fable` at its newest commit: no conflicts at any step; lint 0 findings; unit 1478 tests, 1473 pass, 5 skipped; `npm run build` gives a manifest of 153 files that covers all 121 runtime modules, including `src/core/pq/members.js`.
2. **CI on `fable-writer` fails only the Browser step**, because `members.js` is not in the committed `asset-manifest.json` (T-PRIV-1). The build in point 1 fixes it. Lint and unit pass; one unit failure on the merge commit passed on re-run.
3. **Strings.** Every new reason code is in the table "Strings and error codes for trunk" in `PROGRESS-writer.md`. The latest additions are `refused.unsupported` ("Not changed. This change is not available yet.") and `refused.noMacros`, `refused.moduleKind`. No `QuoinError` code was added, so `ERRORS` needs nothing.
4. **Wiring** (`executeFile` and `failedResult` are not called by the worker or the pool yet): pass `recipe`, `meta`, `runId`, `acknowledgeSignature` (once the user has confirmed signature loss for the set) and, for align, `alignText` from `alignSourceFor`. Pass `shouldStop: () => performance.now() > startedAt + limit`; `executeFile` then fails the file with `m.timeout` between targets and between matches, as your notes ask. One match that backtracks without end still cannot be interrupted from inside the worker, so the pool must also terminate the worker at the limit and call `failedResult(filePlan, 'm.timeout', { recipe, meta, runId })`.
5. **Refresh warning.** `ApplyResult.warnings` can now hold `{ code: 'refresh.notApplied', part: queryName }` for a recipe that asked for refresh on open where that cannot be applied (Q5). Please give it a string and show it next to the row; the table is in `PROGRESS-writer.md`.
6. **A bug in trunk's files.** `src/app/outputs.js` line 88 builds `index.xlsx` with `tablesToXlsx([indexTable(indexes)])` and no frozen `now`, so its inner package takes the real clock. It makes `collect-run.test.js` ("the same time is used for every file…") flaky and means Collect output differs between Preview and Run if two runs straddle a two-second boundary. Pass `{ now: zipClock(now) }` through to the `writeZip` call in `src/core/export/xlsx.js`.
7. **Dead code after the merge.** `writeQueryEdits` and `buildDataMashup` have no caller in `save.js` any more; retire them if nothing else calls them.
8. **Browser and Preview work Writer did not do** (not in Writer's files): diff rows for each replace match (`changes[].matches` carries `{ line, col, before, after }`), the signature confirmation gate, and the browser tests named in F2-04 to F2-09.
