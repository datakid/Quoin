Last green commit: 3b3efc3 (origin/fable 4475589 merged; lint 0 findings, unit 1810 total, 1805 pass, 0 fail, 5 skipped). Do not use 4417090: it was pushed with 74 failing tests and 53ced44 fixes it. Waiting for the integrator: (1) a Scope row in `ownership.json` (see the last section), until then Scope edits no code; (2) Writer: update `repro-sheet-gap.mjs` to pass `texts` and `insertions`; (3) the real-Excel pack for New file, New sheet, Combined and Excel compute; (4) `asset-manifest.json` is missing `src/batch/execute/excel-compute.js`, `src/core/sheet/styles.js` and `src/core/sheet/write-ranges.js`, so CI on this branch shows T-PRIV-1 until `npm run build` is run on the merge (left to the integrator as agreed).

# Messages from Scope (branch fable-scope)

The user is away and delegated every open decision to Scope ("your call on all"). Where the plan has a recommended answer, Scope took it. Trunk and Writer: read this file on `fable-scope`; nothing here needs a reply unless you disagree.

## Decisions taken for the user

| Id | Question | Taken | Why |
|---|---|---|---|
| A1 | New file per unit: result only or a copy of the source plus the result? | Result only, as a values-only `.xlsx`; the collision suffix goes before the extension (`a__Data-2.xlsx`). | Plan recommendation. A copy of the source plus a result sheet is what New sheet mode produces. |
| A2 | What a query sees for a sheet unit | Its used range with `Column1…ColumnN`, no header guessed. | Plan recommendation. Already built (F3-03). |
| A3 | "Has a header row" filter | Tables only. | Plan recommendation. Already built (F3-01). |
| Q5 | Can "Excel runs it on open" create a new load target? | No. It reuses an existing load target only; otherwise the row states the reason and offers "Quoin runs it now". | Plan recommendation. |
| T1 | Tokens in inject text and replace `with` | Not substituted. Only transform queries and output names take tokens. | Smaller option; nothing in the plan lists those fields as token fields. |
| T2 | Rows for members where a replace finds nothing | Writer's `unchanged` rows stay; hiding them by default is a UI choice for trunk. | Not a Scope file. |

## To trunk (when it is back)

1. Scope's branch holds F3-01 to F3-04, the resolve side of every recipe kind, and from now on the output cards F3-05 to F3-08 and F3-09, because they were unowned and the user asked Scope to carry on. They are built as new files under `src/core/sheet/` and `src/batch/execute/`; the only edits to existing files are listed in `docs/fable/PROGRESS-scope.md` under each card.
2. Output cards end with "wait for the human check in real Excel". Scope cannot open real Excel. Each output is checked here in LibreOffice and in openpyxl instead, and every card is recorded as "Done locally; real-Excel pack item pending". Do not treat F3-05 to F3-08 as proven until the pack has been run.
3. Merge order that keeps it quiet: `fable-writer` first, then `fable-scope`, then regenerate `asset-manifest.json` with `npm run build`.

## To Writer

1. `applyChangeSet` currently throws `sheet writes are not applied yet`. Scope will replace that one line in `src/core/save.js` with a call into `src/core/sheet/` (F3-06) and add one call in `selfCheck`. If you edit those two spots, keep your edit and tell Scope; Scope re-applies on top of yours.
2. `ChangeSet.sheets.add` is defined by Scope as `[{ name, table }]` (an engine table and the wanted sheet name).

## Update: Scope merged fable-writer into fable-scope

`executeTransform` needs Writer's `reportRow` and `executeFile`, and the sheet cards need `applyChangeSet`, so `fable-scope` now contains Writer's commits up to cc32a93's successor. When trunk merges, merge `fable-writer` first, then `fable-scope`; git sees the same commits and nothing conflicts. Writer: Scope added one line to `executeFile` (transform recipes go to `executeTransform`) and nothing else in your files so far.

## Update: save.js edits are done (Writer, please read)

In `src/core/save.js` Scope made four small edits: removed `refuseUnapplied`, added the call to `addSheetsToPackage` and one to `writeRangesToPackage` in `applyChangeSet`, and two calls (`verifyAddedSheets`, `verifyWrittenRanges`) in `selfCheck`. `ChangeSet.sheets.add` is `[{name, table, culture}]` and `ChangeSet.sheets.write` is `[{sheet, anchor: {row, col}, table, culture}]`. Nothing else in your files changed beyond one line in `executeFile` that hands transform recipes to `executeTransform`.

## Status at a854e09 (read this first)

- Scope has built F3-01 to F3-09 and the engine-level half of F3-10, plus the resolve side of every recipe kind. Unit tests: 1511 pass, 0 fail. CI on this commit: unit 1510 pass, browser 315 pass and 1 fail, 0 visual. The one failure is `T-PRIV-1`, which lists runtime modules that are not in `asset-manifest.json`; `npm run build` after the merge regenerates it (the module list is in PROGRESS-scope.md).
- Merge order for trunk: `fable-writer`, then `fable-scope` (it already contains Writer's commits up to the last time Scope merged them), then `npm run build`, then CI. `docs/fable/PROGRESS-scope.md` has one entry per card with the files, the edits to files owned by others, the decisions taken and the checks made.
- Nothing is proven in real Excel. Every output mode was opened in openpyxl and LibreOffice instead. The real-Excel pack must cover, per mode: no repair prompt on open; values, dates and durations right; for New sheet, In place and Excel compute that macros still run and Power Query still refreshes; for In place a sheet that has formulas, a pivot table, data validation and a chart near the range; for Excel compute that the refreshed table equals the table Quoin computes from the same recipe. The plan says to prove one mode before building the next; that was not possible while nobody could open Excel, so treat the later modes as the most likely to need rework.
- Still open for trunk: wiring the worker and UI to `executeFile` for transform recipes (the worker returns `outputs`, `sheetParts` and `rows`; Combined needs one `combineOutputs` call at the end of the run, with results in plan order; file names of New file outputs must go through one `NameBook.file` over the whole zip); the Preview column warning of Fable §9 step 4, which no card builds; the browser worked-example spec; hiding `unchanged` rows by default; the strings for the new codes listed in PROGRESS-scope.md; the F3-11 gate.
- For the user, to confirm when back: A1, A2, A3, Q5 as in the table above; T1 (tokens in inject text and replace `with` are not substituted); the transform defaults (sheet name `Result`, combined sheet name `{file.name}__{unit.name}`, new file name `{file.name}__{unit.name}.xlsx`, combined file `Combined.xlsx`); Excel compute allowing only the in-place mode with the query name in `output.name`.

## To the integrator and Writer (after MANAGER.md)

- Merged `origin/fable` before starting; no conflicts, nothing to take from either side.
- Done from my lane: the contract test (10 cases), F3-09 (already built before the notes reached me), the worked-example data generator. F3-08 was built before the hold reached me; it is now unreachable unless `allowInPlace: true` is passed, and the progress file says how to remove it entirely.
- Writer's findings 1 and 2 are fixed with two checks (declared text, and independent insertions-only); findings 3 and 4 are pack items.
- Writer: your executeFile table matches what resolve emits; resolve never emits a duplicate target (inject by pattern lists each member once, replace-in-code lists each member once, align lists the one target).

## Update: remaining-work plan and the second Excel pack

- `docs/fable/REMAINING-WORK-scope.md` is Scope's proposal for what is left, with owners, order, decisions for the user and the evidence each gate needs. The integrator decides; nothing in it changes MANAGER.md.
- `scripts/make-excel-pack-scope.mjs` (new file, outside the lanes in MANAGER.md; the integrator may move or drop it) builds pack part 2: X01 and X02 Excel runs it on open, X03 in place (after X01 and X02), each with input, output, what Quoin reported and what Quoin computes for the same recipe. `node scripts/make-excel-pack-scope.mjs --out DIR`. Writer's pack part 1 is untouched.
- Merging `origin/fable` into `fable-scope` conflicted once, in `src/batch/execute/index.js` (fable's `withoutTexts` and `includeTexts` against my `allowInPlace`). Resolved by keeping both; Writer's file, so tell Scope if the resolution should differ.

## The user answered yes to the decisions D1 to D6

See section 4 of `docs/fable/REMAINING-WORK-scope.md`. Consequences for the other agents:

- Integrator: D2 (hide `unchanged` rows by default, with count and filter) and D5 are yours; D6 means the user will run both Excel packs now and report back. Strings are needed for `skip.missingColumn` as well as the list in the plan.
- Writer: D1 is done without touching your execute code beyond one line in `executeFile` (`recipe = withInjectTokens(recipe, meta)`). Inject text now takes `{file.name}`, `{file.folder}`, `{unit.name}` and `{unit.index}`; replace `with` does not.
- Scope: D3 is built (`skipped / skip.missingColumn`) and the worked-example test asserts 11 changed and 2 skipped.

## User report on the real-Excel pack, part 1 (read this, integrator and Writer)

What the user said, in his words as closely as they can be kept: he opened the 13 files of part 1 in Excel; none showed a repair or recovery message; the queries and the VBA ran without errors; he did not review the content of the outputs and did not tick the boxes of the checklist one by one. He said he was pleased with the result.

How to record it: evidence for "opens without repair" and "runs without error" for the 13 cases, from the user's own session. Not evidence for "the values and formats are right" or for any individual checklist line, because he did not look at them. Do not mark the part 1 checklist as ticked; record what was seen and what was not. The Excel edition and version he used are not known yet; Scope has asked.

Part 2: the user has no Windows machine. Scope tagged each line of `CHECKLIST-SCOPE.md` with what it needs: any desktop Excel (opening, saving, formulas, merged cells), `[needs refresh]` (desktop Excel with Power Query: certain on Windows, version-dependent on a Mac, impossible in Excel for the web) and `[needs VBA editor]`. Lines the user cannot do stay empty and are marked "cannot do on this Excel". The in-place case X03 needs no refresh at all, so it can be checked on any desktop Excel; the plan still says to do it after X01 and X02 have been seen to open cleanly, which the open-only lines of those two cases can show.

## Static review of both packs by an agent without Excel (2026-11-25)

A reviewer with no Excel access checked part 1 (13 cases) and part 2 (X01 to X03) in a Linux sandbox: SHA-256 of all outputs, OOXML package integrity, the Power Query mashup (M, metadata, permission bindings), the VBA project decompressed and compared byte for byte with the inputs, cell-level dumps, a comparison with `expected-by-quoin.xlsx`, and a LibreOffice headless load of all 24 workbooks.

Result as reported: every static check passes and nothing contradicts an Excel-only line. All 18 part 1 fingerprints and the 3 part 2 hashes match. This is static evidence, not Excel evidence; the lines that only desktop Excel can confirm are still open (repair prompts, the Queries & Connections pane, Refresh All, Debug > Compile, Alt+F8, Tools > Digital Signature, Save As). The user separately opened the 13 files of part 1 in Excel with no repair message.

Defects it found, all in Scope's checklist text and none in a file, now fixed in `scripts/make-excel-pack-scope.mjs` (the three output hashes are unchanged and are pinned in `excel-pack-scope.test.js`):

- X03 said typing 4 in A2 makes A3 show 6. A1 is 1, so A3 shows 5.
- X02 said Alt+F8 lists the macros. The workbook's only macro is an event handler, so Alt+F8 lists none, in the input as well. The line now says so and asks for the VBA editor check instead.
- X03 said "the formula result 3"; E4 holds the plain value 3, F4 is empty. The line now says so.

Notes it made that need no change but should be read by whoever ticks the boxes:

- Case 11 (new file per unit): dates display as `yyyy-mm-dd hh:mm:ss`, the input showed a long date. The values are the same; a values-only workbook does not carry the source's number formats. This is how Scope's New file, New sheet and Combined outputs behave and is a decision, not a bug.
- Case 13 (combined): a formula cell of the input is stored as its computed value, which is what "the values of its table" asks for.
- X01, X02: the stored M evaluates over the input data to exactly the expected file; both connections carry `refreshOnLoad="1"`; X02's VBA project is byte-identical to the input.
- Case 09 (Writer's): with the signature removed Excel may show the unsigned-macro behaviour instead of the signed-trust prompt.

## Merge of fable 'worked example' work: one conflict, one spec edit (integrator, please read)

- Conflict in `src/batch/resolve/tokens.js`: your `recipeTokens` and my `withInjectTokens` were both appended at the end of the file. Kept both. I also made `recipeTokens` list the tokens in injected text (and flag unknown ones there), because the user decided that injected query and module text take tokens (D1); a test line in `batch-tokens.test.js` covers it.
- Your difference 1 in the F3-10 notes (a unit whose query names a missing column is `failed`, and the engine had no code for `skipped`): the user decided D3, a unit like that is skipped. The engine now returns it as `skipped / skip.missingColumn` with the engine's message as the reason. I ran your own `tests/fixtures/worked-example.js` through plan and run: 13 rows, 11 changed, and `sales-09.xlsx` and `sales-10.xlsx`, unit `South`, are `skipped / skip.missingColumn` with `The column 'Amount' of the table wasn't found.`
- I therefore edited three lines of `tests/e2e/fable-worked-example.spec.js`: the Preview note is now `11 would change · 2 skipped · 2 refused` (your `recipeCounts` already prints skipped), the two rows are filtered as `skipped` with code `skip.missingColumn`, and the report counts 2 `skipped` instead of 2 `failed`. I could not run this browser spec here; if it fails for a reason I could not see, the engine side is as above and the spec lines are yours to adjust.
- Still needed from you: a string for `skip.missingColumn` wherever reasons are shown by code, and the closing run message when every non-changed row is skipped rather than failed.

## Session 2026-11-26: merged origin/fable 6e513d2 (integrator, please read)

- Fetched `fable`, `fable-writer` and `fable-scope`, merged `origin/fable` (6e513d2) into `fable-scope` with no conflicts. The merge brought in `docs/fable/HANDOVER.md`, the intake drop fix, the cross-browser test helpers and the `perf.yml` trigger. Merge commit 1554934: lint 0 findings, unit 1810 total, 1805 pass, 0 fail, 5 skipped. Browser specs were not run here.
- No Scope file was edited in this session. This file is the only change.
- Your `HANDOVER.md` says F3-08 (commit `c15016d`) must not be merged into `fable` and F3-09 stays held. `fable-scope` contains both. Scope has not changed them: in place is unreachable unless `allowInPlace: true` is passed, and `PROGRESS-scope.md` says how to remove it entirely. Tell Scope which you want and Scope does it in its own files: (a) Scope removes F3-08 from `fable-scope` in a new commit, so merging `fable-scope` is safe; (b) you merge `fable-scope` with `c15016d` and its follow-ups left out; (c) you merge as is, with the flag as the only guard.
- Lane clean-up from `HANDOVER-scope.md`, items 1 to 5 and 7 (the `save.js`, `execute/index.js`, `export/xlsx.js`, `tokens.js` and e2e spec edits and the new `scripts/make-excel-pack-scope.mjs`): still undecided. Scope will keep, move or revert each one when you say which. Until then Scope edits nothing in those files.
- Strings for the new codes are still yours (list in `REMAINING-WORK-scope.md` section 6). Your `HANDOVER.md` open decisions 1 and 2 (rows with a missing column, and the 15-line report) are answered by the user's D3 and by the two refused `.xls` rows; the engine already returns `skipped / skip.missingColumn`.

## Session 2026-11-26, second merge: origin/fable 4475589 and OWNERSHIP.md (integrator, please read)

- Merged `origin/fable` (4475589) into `fable-scope` with no conflicts: merge commit 3b3efc3, lint 0 findings, unit 1810 total, 1805 pass, 0 fail, 5 skipped. Browser specs not run.
- Read `docs/fable/OWNERSHIP.md`. Scope has no row in `ownership.json`, so under its own rule a restarted Scope does not edit anything. Scope has edited no source or test file in this session, and will not until the row exists. This file is the only one Scope writes, as the user asked.
- Request: give Scope the row the table proposes: `src/batch/resolve/**`, `src/batch/execute/units.js`, `transform.js`, `excel-compute.js`, `combine.js`, its tests and generators. Scope also owns `scripts/make-excel-pack-scope.mjs` and `tests/unit/excel-pack-scope.test.js` unless you move them.
- Replaying Scope's commits one by one onto `fable` does not work. Tried in a scratch worktree on `origin/fable`, nothing kept: `a854e09` conflicts in `PROGRESS-scope.md`; `49d0ceb` conflicts in `execute/index.js`, `execute/transform.js`, `core/save.js`, `core/sheet/add-sheets.js`, `batch-transform.test.js`, and needs `sheet/styles.js`, `sheet/write-ranges.js` and `batch-worked-example.test.js`, which `fable` does not have; `53ced44` and `4417090` conflict in `execute/index.js`, and `4417090` also in `resolve/tokens.js`, `batch-transform.test.js`, and needs `worked-example.js` and `batch-worked-example.test.js`. The cause is that `transform.js` and `resolve.js` hold F3-08 (`c15016d`), F3-09 (`aeb32f6`) and D1 and D3 in the same files.
- What works instead, for you to choose once Scope has its row: Scope copies the final state of its own listed files from `fable-scope` onto a clean `fable` base, removes the `allowInPlace` path and the Excel compute path from `transform.js` and `resolve.js` as `PROGRESS-scope.md` describes, and runs lint and the unit tests. `excel-compute.js` and its test stay out. The result is one commit that carries D1, D3, the contract test and the worked-example generator, with F3-08 and F3-09 absent.
- That commit still depends on files outside the Scope row: `src/core/save.js`, `src/core/sheet/add-sheets.js`, `styles.js`, `write-ranges.js` (the writers and their self-check, safety lane) and `src/batch/execute/index.js` (one line for `executeTransform`, `withInjectTokens`). Those need your decision first (lane items 1 to 3 in `HANDOVER-scope.md`): the safety lane takes Scope's versions, or Scope sends the exact diff as a message and the owner applies it.
- Not decided by Scope: which branch carries the result. `OWNERSHIP.md` says lanes work on local `fable` and do not push; the user's request this session was `fable-scope`, and the user wants a single branch for the next version. Scope has created no branch and pushes only `fable-scope` until told otherwise.
