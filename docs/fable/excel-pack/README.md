# Real-Excel pack (F2-15)

Quoin writes Excel files itself, and its own reader and checks cannot say whether Excel accepts them. The pack puts the output of every writing path in front of a person with Excel.

## Build it

```
node scripts/make-excel-pack.mjs [path/to/quoin-excel-pack.zip]
```

With no path it writes `quoin-excel-pack.zip` in the current folder (ignored by git). The clock is frozen, so building twice gives the same zip, byte for byte. The script runs every case through the path the app will use (`parseRecipe`, `resolvePlan`, `executeFile`, `combineOutputs`, `applyChangeSet`) and stops with an error if a case does not give a verified change, so a pack that builds is a pack whose files Quoin itself verified.

## What is in it

`CHECKLIST.md` at the top of the zip, and one folder per case under `cases/NN-name/` with `input/`, `output/` and, for the locked-project case, `recipe/`. Twenty cases: queries (replace, replace with refresh on open, add, add with awkward names, remove, rename, replace text), modules in generated and in Excel-made workbooks (replace, add, remove, replace text), signed projects (replace, add, remove: the signature is removed and the checklist says to check that), a locked project that Quoin must refuse (a file the person makes in Excel), and the result modes (new file, new sheet, combined, new sheets in a macro workbook and in a signed one). Every case starts with "open the input first", so a bad input cannot be mistaken for a bad output.

## Who made what

The script and its first thirteen cases are the integrator's. Writer reviewed them and added the cases and checks that cover Writer's paths (see `docs/fable/MESSAGES-writer.md`, "Review of the real-Excel pack"). `tests/unit/excel-pack.test.js` is the integrator's; `tests/unit/excel-pack-claims.test.js` checks that the text of the added cases matches the files.

## What it does not do

Nothing in it is checked. Until someone has ticked the boxes in real Excel, none of the writers is verified against Excel.

`repro-sheet-gap.mjs` in this folder is a separate script: it reproduces findings 1 and 5 about the sheet writer in `docs/fable/MESSAGES-writer.md` and exits non-zero while a gap is open.
