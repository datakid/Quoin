# Handover: Scope (branch fable-scope)

For a new chat that picks up Scope. Read this file, then `docs/fable/MANAGER.md` section 3, then `docs/fable/MESSAGES-scope.md` (the first line names the last green commit).

## Repository

- Repo: `datakid/Quoin` (renamed from `power-query-manager`; GitHub redirects the old name). Set the remote with `git remote set-url origin https://github.com/datakid/Quoin.git`.
- Do not write a token into any file or commit. The user has said the token is no longer valid once all agents finish; ask for a new one if you need to push.
- Branches: `fable` (integrator, trunk), `fable-writer` (Writer), `beta` and `main` (never touched by Scope), `fable-scope` (Scope). Merge `fable` into `fable-scope`; never rebase; never push to the others.

## State at this handover

- Last green commit on `fable-scope` before this file: see the first line of `MESSAGES-scope.md`. This file is committed after the merge of `fable` at 79c3b8c; the commit hash is the head of the branch when you read it.
- Lint: 0 findings. Unit tests: 1807 total, 1802 pass, 0 fail, 5 skipped.
- Built on Scope's side: resolve for every recipe kind; transform outputs New file, New sheet, Combined, In place (held behind `allowInPlace`), Excel compute (`compute: 'excel'`, reuses an existing load target only); the sheet writers and their self-check; the contract test; the worked-example data generator; inject tokens (D1); `skip.missingColumn` (D3); the second real-Excel pack generator `scripts/make-excel-pack-scope.mjs`.
- Real-Excel status: the user opened all 13 files of pack 1 in Excel: no repair message; queries and VBA ran without error; outputs not reviewed. Pack 2 (X01 to X03) needs desktop Excel; the user has no Windows machine. A reviewer checked both packs statically and found nothing contradicting Excel; the reviewer's defects were in Scope's checklist text and are fixed.
- Plan: `docs/fable/REMAINING-WORK-scope.md` (owners, order, evidence).

## Lane violations Scope made (must be fixed or reported to the integrator)

MANAGER.md says files not listed for an agent stay with the integrator, and Scope's list is: `src/batch/resolve/**`, `src/core/snapshot.js`, the new `src/batch/execute/units.js`, its own tests, and (this cycle) the contract test, the worked-example generator, F3-09 in resolve and execute, and writer-facing contract code. Scope went outside that list in these places:

1. `src/core/save.js` (Writer's): removed `refuseUnapplied`, added calls to `addSheetsToPackage`, `writeRangesToPackage`, `verifyAddedSheets`, `verifyWrittenRanges`, the declared-text and insertions checks in `selfCheck`. The manager asked Writer to review these, not Scope to change them; Writer's review then found a gap that Scope fixed in the same file.
2. `src/batch/execute/index.js` (Writer's): one line for transform, `allowInPlace`, `withInjectTokens`, a merge conflict resolved by keeping both sides.
3. `src/core/export/xlsx.js` (trunk's): `tableToXlsx` now uses the shared sheet builder; `workbookFromSheets` and multi-sheet `tablesToXlsx` added; `tests/unit/outputs.test.js` (trunk's) changed one assertion.
4. `src/batch/resolve/tokens.js`: merged with trunk's `recipeTokens` and extended it to injected text.
5. `tests/e2e/fable-worked-example.spec.js` (integrator's): three lines changed from failed to skipped, and the Preview note text. Not run here.
6. `tests/unit/batch-chain.test.js` and `batch-units.test.js` (mine), and `batch-transform.test.js` (mine), fine.
7. `scripts/make-excel-pack-scope.mjs` is new and outside every lane; the integrator may move or drop it.

None of these was agreed before it was made. The rule to keep from now on: if a change needs a file in someone else's list, Scope writes the change as a message in `MESSAGES-scope.md` and the owner applies it, unless the owner says in writing that Scope may.

## Rules for the next session of Scope

1. Start every session with `git fetch` on all three branches and `git merge origin/fable`. Read the integrator's latest `PROGRESS.md` and `MANAGER.md`.
2. Touch only: `src/batch/resolve/**`, `src/core/snapshot.js`, `src/batch/execute/units.js`, `src/batch/execute/transform.js`, `src/batch/execute/excel-compute.js`, `src/batch/execute/combine.js`, `src/batch/execute/replace.js` and `align.js` (only if Writer has not taken them), `src/core/sheet/**`, `src/core/export/limits.js`, `tests/unit/batch-*.test.js` and `sheet-*.test.js` and `excel-pack-scope.test.js` (Scope's own), `tests/fixtures/generators/worked-example.js`, `scripts/make-excel-pack-scope.mjs`, and the Scope docs. Anything else: message, do not edit.
3. Before every push: `npm run test:lint` and `npm run test:unit` both green on the commit you push. Never push a red commit. (Commit 4417090 was pushed with 74 failing tests; 53ced44 fixed it. Do not repeat.)
4. Write each card's result in `PROGRESS-scope.md` with the fact that it was verified in what tool, and what was not verified (real Excel, browsers).
5. Do not mark anything as proven in Excel. The user's pack 1 result is recorded as exactly what he saw.

## Open for Scope

- Lane clean-up (above): ask the integrator whether to keep, move or revert items 1 to 5 and 7.
- Browser spec for worked example: owned by the integrator; Scope supplies data only.
- X03 (in place) stays held until the user checks X01, X02 and X03 in desktop Excel.
- Anything the user asks next: answer from the files, not from memory.

## Open for others (not Scope's to do)

- Integrator: wire New sheet, Combined and Excel compute into the screens; the remaining specs (memory, privacy, recipes, worked example); F4 and F5; `skip.missingColumn` string; D2 (hide unchanged rows); the asset manifest after merge; delete dead code in `save.js` (`writeQueryEdits`, `buildDataMashup`) if nothing calls them.
- Writer: the items in `MESSAGES-writer.md`, including `repro-sheet-gap.mjs` passing `texts` and `insertions`.
