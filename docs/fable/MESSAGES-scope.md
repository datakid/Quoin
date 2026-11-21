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
