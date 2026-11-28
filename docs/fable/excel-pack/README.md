# Start here: checking Quoin's files in desktop Excel

If you were given `quoin-excel-kit.zip`, read the `START-HERE.md` inside it and not this page. This page is for the two zips when they are given to you separately.

This page is for a person who has desktop Excel and nothing else. You do not need Node, the repository or an agent. Someone gives you two zip files and you need only this page and the checklist inside each zip.

## The two zips, in this order

1. `quoin-excel-pack.zip`: 22 cases. Work through them in number order, 01 to 22. Some cases use the output of the case before as their input, and say so.
2. `quoin-excel-pack-scope.zip`: cases X01, X02 and X03. Do X01 and X02 first. X03 is marked "hold": open it only after you have done X01 and X02.

Unzip each zip into its own folder and open the files from there, not from inside the zip window. The checklist is at the top of each zip (`CHECKLIST.md`, `CHECKLIST-SCOPE.md`): keep it open next to Excel. Each case has an input and an output (in the first zip two folders called `input` and `output`; in the second two files with those names). Open the input first, then the output, so a bad input is not mistaken for a bad output. Some X cases also hold `expected-by-quoin.xlsx`: the checklist says when to open it. Do what the case says about saving; if it says nothing, close the file without saving.

## Write down your Excel first

Before case 01, write down:

- Windows or Mac.
- The edition and version: on Windows, File > Account > About Excel; on a Mac, Excel > About Excel.
- Whether the Data tab has Get Data and Refresh All (that is Power Query).
- Whether the VBA editor opens: Alt+F11 on Windows, Tools > Macro > Visual Basic Editor on a Mac.

These decide which lines of the checklists you can do.

## What "no repair message" looks like

The file opens and shows its sheet. A repair message is a window that appears while the file opens. On Windows it says Excel found a problem with some content and asks whether to try to recover as much as it can; after you say yes it says it was able to open the file by repairing or removing the unreadable content, and lists what it removed or repaired. A repair message is a fail even when the file then looks fine.

These are not repair messages:

- A yellow Protected View bar: click Enable Editing.
- A yellow security bar about macros or data connections: click Enable Content, or enable macros, when the case tells you to.
- The question whether to save changes when you close a file.

If you see a repair message, take a screenshot before you click anything, then click yes and take a screenshot of the list of what Excel says it removed or repaired.

## What to write down

- Your Excel line, once, at the top of the first checklist.
- If a line cannot be done on your Excel (no Power Query, no VBA editor), leave its box empty and write "cannot do on this Excel". Do not guess.
- In `quoin-excel-pack.zip`, each case has a pass box and a fail box. Tick pass only when every line of the case was true. Otherwise tick fail and write one line on what you saw.
- In `quoin-excel-pack-scope.zip`, each line has its own box. Tick a line only when you saw it happen, and write what you saw under the case if something differs.
- Send back the checklists with your notes, the numbers of the cases that failed, and the screenshots.

Nothing in either zip is ticked or marked as verified. The boxes are yours to tick.

---

# Real-Excel pack (F2-15), for the people who build it

Quoin writes Excel files itself, and its own reader and checks cannot say whether Excel accepts them. The pack puts the output of every writing path in front of a person with Excel.

## Build it

```
node scripts/make-excel-pack.mjs [path/to/quoin-excel-pack.zip]
```

The second zip is Scope's: `node scripts/make-excel-pack-scope.mjs --out <folder>` writes `quoin-excel-pack-scope.zip` and `CHECKLIST-SCOPE.md` (cases X01, X02, X03: Excel compute and in place). The script is on `fable`, but it can only build where the in-place and Excel-compute code exists, and `b01773e` took that code out of the tree. Build it on `fable-scope` at `a73dd99` (the commit before that one). Built there it is 3 cases and 12 files, and its SHA-256 is `27a45271929445eb3ee6c9c29dd998585a03247b3c289d6d480648573aa7cd9d`.

## Build the kit and read the results

```
node scripts/make-excel-kit.mjs /tmp/kit.zip --scope-zip path/to/quoin-excel-pack-scope.zip
node scripts/read-excel-results.mjs path/to/RESULTS.csv
```

The kit is one zip: `START-HERE.md`, one `CHECKLIST.md` with all 25 cases in the order to open them, one folder per case under `cases/`, and an empty `RESULTS.csv`. Without `--scope-zip` the kit runs `scripts/make-excel-pack-scope.mjs` itself, which fails on `fable` for the reason above. `read-excel-results.mjs` reads the filled file and prints the wording for `docs/observations.md` and the README, claiming only what the filled cells justify: an empty cell is "not checked", never "yes".

With no path it writes `quoin-excel-pack.zip` in the current folder (ignored by git). `--only=a,b` builds just the named cases (case names are the folder names without the number); `--only=writer-added` builds the nine cases Writer added (the query, module and signed-project cases that cover Writer's paths), which are the ones nobody has opened in Excel yet. That smaller pack is numbered from 01 and has its own checklist. The clock is frozen, so building twice gives the same zip, byte for byte. The script runs every case through the path the app will use (`parseRecipe`, `resolvePlan`, `executeFile`, `combineOutputs`, `applyChangeSet`) and stops with an error if a case does not give a verified change, so a pack that builds is a pack whose files Quoin itself verified.

## What is in it

`CHECKLIST.md` at the top of the zip, and one folder per case under `cases/NN-name/` with `input/`, `output/` and, for the locked-project case, `recipe/`. Twenty-two cases (the Excel-made module case is three cases, one per output, so the person can say which one failed; numbers in older notes refer to the earlier twenty-case pack): queries (replace, replace with refresh on open, add, add with awkward names, remove, rename, replace text), modules in generated and in Excel-made workbooks (replace, add, remove, replace text), signed projects (replace, add, remove: the signature is removed and the checklist says to check that), a locked project that Quoin must refuse (a file the person makes in Excel), and the result modes (new file, new sheet, combined, new sheets in a macro workbook and in a signed one). Every case starts with "open the input first", so a bad input cannot be mistaken for a bad output.

## Who made what

The script and its first thirteen cases are the integrator's. Writer reviewed them and added the cases and checks that cover Writer's paths (see `docs/fable/MESSAGES-writer.md`, "Review of the real-Excel pack"). `tests/unit/excel-pack.test.js` is the integrator's; `tests/unit/excel-pack-claims.test.js` checks that the text of the added cases matches the files.

## What it does not do

Nothing in it is checked. Until someone has ticked the boxes in real Excel, none of the writers is verified against Excel.

`repro-sheet-gap.mjs` in this folder is a separate script: it reproduces findings 1 and 5 about the sheet writer in `docs/fable/MESSAGES-writer.md` and exits non-zero while a gap is open.
