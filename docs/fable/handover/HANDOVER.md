# Fable handover (trunk agent, stopped by the user)

## Where everything is

- Branch `fable`, local and on origin. Last commit I made: `96418d8` (F4-01 wired: Save recipe, loading through `recipe-files.js`, seven browser tests, progress entry). Local `fable` at that commit is NOT yet merged with `origin/fable` at `7c71b9b`. The merge conflicted in five files (`asset-manifest.json`, `docs/fable/PROGRESS.md`, `src/app/main.js`, `src/ui/set/recipe-panel.js`, `src/ui/set/shell.js`, `src/ui/strings.js`). I aborted it. The next person must merge `origin/fable` into their branch, resolving in favour of the integrator for every wiring file (`main.js`, `recipe-panel.js`, `shell.js`, `strings.js`), keeping my new `recipe.tooLarge`, `recipe.binary`, `recipe.unreadable` string entries and my `recipe-files.js` import swap, then regenerating `asset-manifest.json` with `npm run build`.
- Branches `fable-writer` and `fable-scope` are merged into `fable` already.
- Full plan: `docs/fable/01_PLAN.md` (copy also in `docs/fable/handover/`). Decision document: `docs/fable/00_FABLE.md`.
- Manager notes: `docs/fable/MANAGER.md`. Parallel rules: `docs/fable/PARALLEL.md`. Agent rules: `docs/fable/NOTES-FOR-AGENTS.md`.
- Progress: `docs/fable/PROGRESS.md` (trunk), `PROGRESS-writer.md`, `PROGRESS-scope.md`.

## What is done (all on `fable`)

- Phase F0 (set, pool, intake, shell, single file from the set with the 18-test parity spec), F1 (recipe model, resolve, collect execution and outputs, result table, versions panel, 500-file scale, read-only proof, F1 gate written with one box open for a person).
- Phase F2 (Writer's F2-01 to F2-09, integrator's Preview, Get as zip or folder, signature confirmation, Excel pack with Open XML validation on CI). The integrator wrote the F2 gate.
- Phase F3 (Scope's resolve, scope, units, chains, transform; integrator wired F3-05).
- F4-01 and F4-03 pure modules (`src/app/recipe-files.js`, `src/app/recipe-store.js`) with unit tests and the three-key T-LINT-8 rule and T-PRIV-3 test. F4-03 is not wired.

## What is left

1. Finish the merge above and push. Confirm CI green on lint, unit and browser.
2. Record the CI result for `96418d8` in `PROGRESS.md`.
3. F4-03 wiring: `createRecipeStore(window.localStorage)` in `main.js`; Stored recipes list in the Recipe region; `rememberSet` when a set is created (folder name or "N files" only, never a path). Notes are in `PROGRESS.md` under "Notes for the integrator: wiring F4-01 and F4-03".
4. Strings still to add when their code lands (T-E-11 rejects unused keys): `recipe.name`, `recipe.storeFull`, `recent.name`, `recent.store`.
5. Regenerate `asset-manifest.json` after every merge (`npm run build`), and never commit it by hand.
6. Remaining plan items: F4-02 and F4-04 (recipe editor wiring, schema and validation review), Phase F5 (performance and memory measurements, published numbers), and the by-hand slice a person must do in Chromium.
7. Real Excel: the pack in `tests/...` (F2-15) has a checklist; a person must open it in Excel. Nothing is marked verified in Excel.

## Rules to keep

- No code comments anywhere. No `console.log`. No new dependency.
- Test first; prove each new test fails without its change; deliberately break the code once to see the test fail, then restore.
- Never edit an existing test's expectation, skip it or delete it unless the plan names that change; record any named change in PROGRESS.
- One commit per task, subject `F4-03: short imperative`, body two to four plain lines.
- Push only to `fable` (trunk) or your own agent branch. Never force-push. Never delete a branch.
- Merge `origin/fable` before every push; resolve wiring files in favour of the integrator.
- The GitHub token used in this session belongs to the user and is to be revoked by them when work pauses. Do not write it into any file.

## Open decisions still with the user

- Confirm whether a person will do the by-hand Chromium walk-through and the Excel check; both are needed before the gates are fully closed.
- Measured limits (F5): the starting memory budgets (768 MiB in flight, 384 MiB on low-memory devices, 1 GiB zip ceiling) are guesses until F5 measures them.
