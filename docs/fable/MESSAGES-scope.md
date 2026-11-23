Last green commit: 5fff77f (fable 79d4a63 merged in; lint 0 findings, unit 1676 pass, 0 fail, 5 skipped; a trial merge into fable is clean). Waiting for the integrator: (1) merge `fable-scope`; (2) decide whether to keep F3-08, held behind `allowInPlace` (see PROGRESS-scope.md); (3) Writer: update `repro-sheet-gap.mjs` to pass `texts` and `insertions`; (4) the real-Excel pack for New file, New sheet, Combined and Excel compute; (5) `asset-manifest.json` is missing `src/batch/execute/excel-compute.js`, `src/core/sheet/styles.js` and `src/core/sheet/write-ranges.js`, so CI on this branch shows T-PRIV-1 until `npm run build` is run on the merge (left to the integrator as agreed).

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
