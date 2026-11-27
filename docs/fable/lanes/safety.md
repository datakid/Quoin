# Lane: safety

Plan part: F3-11, the Transform gate. Bring the "a sheet writer may only insert what it declares" after-write check onto `fable`, with the false refusal that the Gemini draft found already fixed, and without any of the held in-place code (F3-08).

Read `docs/fable/OWNERSHIP.md` first. Its rules apply to you in full.

## Your files

- `src/core/save.js`
- `src/core/sheet/**` (`add-sheets.js`, `grid.js`, `names.js`, `sheet-xml.js`, and any new file you add here)
- `tests/unit/sheet-*.test.js` (existing `sheet-add.test.js`, and new files you add with this prefix)
- `tests/unit/save-safety.test.js`
- `docs/fable/lanes/NOTES-safety.md` (your notes)

Not yours, read only: `src/batch/**`, `src/app/**`, the rest of `src/core/`, every other test. Other tests import `save.js` and must keep passing. If the work seems to need a change in `src/batch/**` (Scope's commit `49d0ceb` changed `src/batch/execute/index.js` and `transform.js` for this), do not make it: write what and why in your notes.

## Setup

Your clone is `/home/claude/lanes/safety`. Unit tests only, no browser.

## The problem

On `fable`, `selfCheck` in `src/core/save.js` skips every part in `touched` (`if (touched.has(e.name) ...) continue`). `addSheetsToPackage` touches `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `[Content_Types].xml` and `xl/styles.xml`. So a bug in the sheet writer that changes anything else in those parts passes the after-write check. That is the gap. Scope closed it on `fable-scope` in `49d0ceb` (F3-11): `addSheetsToPackage` returns `texts` and `insertions` for each touched part, and `selfCheck` verifies that the written part equals the original plus only the declared fragments.

Scope's version has a bug of its own (Writer's Finding 5, pack 2 case T05). `count="…"` is stripped from both texts before the declared fragments are searched for, so when `styles.xml` has no `<numFmts>` and the writer creates the whole `<numFmts count="2">…</numFmts>` element, the fragment can never be found and the write is refused with `write.selfcheck: check.part xl/styles.xml`. It fires for every XlsxWriter workbook and every Excel workbook that only uses General formats.

The fix, in the Gemini draft: strip the fragments from the raw text first, and normalise `count` only at the final whole-text comparison.

```
removable(text, fragments, original, counts):
  no fragments left: counts(text) equals counts(original)
  otherwise: for each position of the first fragment in text, remove it and recurse with the rest
onlyInsertions(original, output, ins): removable(output, ins.fragments, original, strip counts of ins.countElements)
```

A fragment that was not declared still cannot be removed, so the gap stays closed. A created `<numFmts count="2">` is found in the raw text, so the false refusal goes.

## What to do

1. Read Scope's implementation, not to copy it whole: `git show origin/fable-scope:src/core/save.js`, `git show origin/fable-scope:src/core/sheet/add-sheets.js`, `git show 49d0ceb`, and its tests `git show origin/fable-scope:tests/unit/sheet-selfcheck.test.js`. Read the Gemini draft at `/home/claude/lanes/draft-gemini/` (README.md for the reasoning, `src/core/save.js`, `tests/unit/sheet-no-numfmts.test.js`). The draft was written without being able to run anything and is based on commit hashes that do not match the repository, so nothing in it is trusted until it runs.
2. Make `addSheetsToPackage` on `fable` return `texts` and `insertions` for the parts it touches, as Scope's does, working with the files that exist on `fable` (there is no `styles.js` or `write-ranges.js` here and you do not add `write-ranges.js`).
3. Make `selfCheck` verify them with the fixed `onlyInsertions`. The draft's `save.js` imports `./sheet/write-ranges.js`: do not take that file wholesale. `refuseUnapplied` stays exactly as it is: sheet writes into existing sheets stay refused, so in place stays unreachable.
4. Tests, all in files you own, none of them with comments:
   - the three regression cases from `tests/unit/sheet-no-numfmts.test.js` in the draft (one sheet, two sheets, `xw_macro04.xlsm`), through `applyChangeSet`; remove the draft's comments; keep the skip for a missing fixture only if the fixture really can be missing on `fable`
   - the tamper probes: Writer's `docs/fable/excel-pack/repro-sheet-gap.mjs` (`git show origin/fable-writer:docs/fable/excel-pack/repro-sheet-gap.mjs`) has nine probes that must each be rejected, including "change only the `count` of the cell formats". Port them to a unit test through `applyChangeSet`. If a probe cannot be expressed through `applyChangeSet`, say which one and why in your notes.
   - a test that a declared insertion already present in the original part is refused (Scope's `sheet-selfcheck.test.js` asserts this)
   - every existing test in `sheet-add.test.js` and `save-safety.test.js` stays unchanged and green
5. Prove the fix is needed: run the new regression cases against the old behaviour (strip counts first) and record in your notes that they fail there with `write.selfcheck: check.part xl/styles.xml`, and pass with the fix.
6. Prove the gap is closed: record in your notes which of the probes were accepted before your change on `fable` and that none is accepted after.

## Then (queue, in order, do not wait for me)

7. Dead code in `save.js`: `writeQueryEdits` and `buildDataMashup` may have no caller. Search `src/`, `tests/` and `scripts/`. If nothing calls them, remove them and their imports, with no test changed. If something does, leave them and say who calls them in the notes.
8. Mutation audit of `selfCheck`: for every `throw new QuoinError('check.*'` and `write.*` path in `save.js`, find the test that reaches it. Where none does, add a test in `save-safety.test.js`. Then break each check once on purpose (comment-free: edit, run the one test, restore with `git checkout`) and record in the notes that the test fails, so no check is unproven.
9. `sheet-xml.js`, `grid.js`, `names.js`: add tests in your `sheet-*.test.js` files for the edge cases the code handles but no test shows (sheet name length 31, forbidden characters, duplicate names with different case, empty table, one million rows hitting the limit). Each new test must fail when you break the code it covers.
10. Write in the notes the list of checks and the test that covers each, as a table.

## Ruled out

- `write-ranges.js`, `styles.js` from F3-08, any in-place path, `allowInPlace`, anything that makes `sheets.write` do something.
- Changing an existing test's expectation.
- Changes in `src/batch/**` or `src/app/**`.
- Taking the draft's `tests/unit/sheet-add.test.js` advice about "applied and verified" for existing sheets: that is F3-08.

## Done

- New tests pass and the old behaviour fails them as described in item 5.
- Full unit suite 0 failures (5 skipped is the baseline), lint 0, `node scripts/check-ownership.mjs lane safety` prints `all owned`.
- Notes file: what the new `onlyInsertions` does, the probe results before and after, and anything Scope's `src/batch/**` change did that `fable` now needs (for the integrator). Last line `HAND BACK <commit hash>`.
