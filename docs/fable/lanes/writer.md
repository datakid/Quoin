# Lane: writer

You are the Writer agent, working in your own session on branch `fable-writer`. This brief is the integrator's answer to `NOTES-writer.md` and `HANDOVER-writer.md`. Read `docs/fable/OWNERSHIP.md` first; it applies to you. Your row is in `docs/fable/ownership.json` under `writer`.

## How you work

- Branch: `fable-writer` only. First `git fetch origin && git merge origin/fable` (never rebase, never force-push, no new branches). Push `fable-writer` after every task commit. The integrator merges it into `fable`.
- Commit subjects short, git style. Trailer lines as in OWNERSHIP.md rule 5 (leave out `Claude-Session` if your session has no URL).
- No code comments. Lint 0 and unit 0 failures before every push.
- Notes: `docs/fable/lanes/NOTES-writer.md` (a table of item, commit, verified) and your `MESSAGES-writer.md`. Last line of the notes when you stop: `HAND BACK <commit hash>`.
- Never wait for the integrator. Work the queue below from top to bottom. An item that needs a file you do not own gets the exact change written in your notes and you move to the next item.

## Your files

The `writer` row in `docs/fable/ownership.json`: `src/core/pq/**`, `src/core/vba/**`, `src/batch/execute/changes.js`, `src/batch/execute/replace.js`, `scripts/make-excel-pack.mjs`, the writer tests (`batch-pq-members`, `batch-vba-members`, `batch-writer-*`, `batch-replace`, `batch-align`, `batch-save`, `pq`, `vba`, `vba-validate`, `wb-outline`, `excel-pack`, `excel-pack-claims`), `docs/fable/excel-pack/**`, your progress, messages and handover files.

Not yours: `src/core/save.js` and `src/core/sheet/**` (the safety lane, see below), `src/batch/resolve/**` and `transform.js` (Scope), `src/batch/recipe/**`, `src/batch/execute/index.js`, `collect.js`, `run-file.js`, `src/app/**`, workers, `strings.js`, the manifest, baselines.

## Decisions on your questions

1. Your `writer` row: accepted and widened to the list above.
2. `connect`: stays opt-in in the core. No recipe field and no `executeFile` wiring until the user reports pack 3 case 02 from real Excel (decision D6). Commit `30e7599` is accepted, including its three lines in `src/batch/execute/index.js` and the 39 lines in `tests/unit/batch-execute.test.js`: those two files are the integrator's and the integrator takes your edits as they are. From now on you write such a change in your notes instead.
3. Your finding 1 (the sheet writer's touched parts are exempt from every check) is being built on `fable` by the safety lane in `src/core/save.js` and `src/core/sheet/**`: declared insertions, the count-attribute fix from finding 5, and your nine probes from `repro-sheet-gap.mjs` ported as unit tests. You do not edit those files. When it is on `fable`, review it (queue item 6).

## Queue

1. `git merge origin/fable`. Run `node scripts/check-ownership.mjs lane writer origin/fable`. The only files it may list outside your row are `src/batch/execute/index.js` and `tests/unit/batch-execute.test.js`. Put every other foreign file back with `git checkout origin/fable -- <file>` and record it in the notes.
2. Finding 7 of your review: split the three-output case `module-excel-made` in `scripts/make-excel-pack.mjs` into three cases, one per output, so the person can say which one failed. Update `excel-pack.test.js` and `excel-pack-claims.test.js`. Keep every existing claim test.
3. Mutation audit of `src/core/pq/**` and `src/core/vba/**`: every refusal and check (`refused.*`, `QuoinError` codes, `anomalies`) in a table in the notes with the test that reaches it. For a check with no test, add one in your test files. Then break each check once on purpose (edit, run the one test file, `git checkout` the edit) and record that a test fails.
4. Corpus gap check: list every `xw_macro*.xlsm` and other Excel-made workbook in `tests/fixtures` and say which writer operations (add, replace, remove module; signature removal; query replace, add, remove, rename) `batch-writer-corpus.test.js` runs on each. Add the missing combinations, with reopen and a byte check of every part that must not change.
5. The user runs both Excel packs in one sitting (D6). Make `docs/fable/excel-pack/README.md` start with one page for a person who has only desktop Excel: which zip to open, in what order, what to write down (Excel edition and version first), what "no repair message" looks like. Do not tick or pre-fill any box.
6. When the safety lane's work is on `fable` (the integrator tells you in `NOTES-writer.md` of `fable`, or you see `docs/fable/lanes/NOTES-safety.md` ending in `HAND BACK` on `origin/fable`), merge `origin/fable`, run `node docs/fable/excel-pack/repro-sheet-gap.mjs` and `excel-pack*.test.js` against it and write what you find in your notes. A probe that is accepted is a finding for the safety lane: write it exactly in your notes.
7. When 1 to 6 are done, write the notes and `HAND BACK <hash>`. Stop.

## Ruled out

- Making `connect` the default, or wiring it into the recipe.
- Marking anything verified in Excel. The user's pack 1 result is "opened without repair, queries and VBA ran, outputs not reviewed" and nothing more.
- Editing a file outside your row, even for a one-line fix.
