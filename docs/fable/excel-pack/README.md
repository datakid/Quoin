# Real-Excel pack (F2-15)

Quoin writes Excel files itself. Its own reader and checks cannot say whether Excel accepts them, so this pack puts the output of every writing path in front of a person with Excel.

## Build it

```
node scripts/make-excel-pack.mjs
```

This writes `excel-pack/quoin-excel-pack.zip` and `excel-pack/CHECKLIST.md` in the current folder. `--out <folder>` puts them somewhere else. The clock is frozen, so building twice gives the same zip, byte for byte. The script runs every case through the same path the app will use (`parseRecipe`, `resolvePlan`, `executeFile`, `combineOutputs`, `applyChangeSet`) and stops with an error if a case does not produce a verified change, so a pack that builds is a pack whose files Quoin itself verified.

## What is in it

19 cases, each in `cases/<id>-<name>/` with the input workbook and what Quoin wrote from it.

| Group | Cases |
|---|---|
| Queries | Q01 replace, Q02 add, Q03 add with awkward names, Q04 remove, Q05 rename, Q06 replace text in query code |
| Macros | M01 replace a module, M02 add a module, M03 remove a module, M04 replace text in macro code, M08 a locked project (a case you make yourself; Quoin must refuse) |
| Signed macro projects | M05 replace, M06 add, M07 remove, each after confirming that the signature is lost |
| Results | T01 new file per table, T02 new sheets in a copy, T03 combined workbook, T04 new sheets in a macro workbook, T05 a new sheet in a signed macro workbook |

Inputs are the Excel-made files in `tests/fixtures/external` (`pq_simple.xlsx`, `pq_vba_complex.xlsm`, `xw_macro01.xlsm`, `xw_macro04.xlsm`). Q04 and Q05 start from the output of Q02, because Quoin only removes or renames a query it added itself (it has no connection and loads nowhere).

## How a person uses it

Open `CHECKLIST.md`. Each case has a short list of things to look at, in Excel, with a tick box for each. The boxes are empty. A case passes only when every box is ticked; anything Excel says on opening goes into Notes word for word.

## What it does not do

Nothing here is marked as checked. Until someone has ticked the boxes in real Excel, none of the writers is verified against Excel, and the manual case M08 needs a file the person makes in Excel.

## Keeping it honest

`tests/unit/excel-pack.test.js` checks that the zip is valid and every file matches `manifest.json`, that two builds are identical, that every input and output opens, that the text of each case matches the files (the query lists, the modules, the sheets, the signatures), that no box is ticked, and that `docs/fable/excel-pack/CHECKLIST.md` equals what the script makes now. When a writer changes what a case contains, rebuild with `node scripts/make-excel-pack.mjs --out /tmp/pack` and copy `CHECKLIST.md` here.

`repro-sheet-gap.mjs` is a separate script: it reproduces finding 1 in `docs/fable/MESSAGES-writer.md`.
