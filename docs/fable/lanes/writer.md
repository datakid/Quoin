# Lane: writer

You are the Writer agent, working in your own session on branch `fable-writer`. This brief is the integrator's answer to `NOTES-writer.md` and `HANDOVER-writer.md`. Read `docs/fable/OWNERSHIP.md` first; it applies to you. Your row is in `docs/fable/ownership.json` under `writer`.

If you are starting in a new chat: read `docs/fable/AGENTS.md` first (section "Picking up in a new chat"), then this brief, then the `## State` block at the top of `docs/fable/lanes/NOTES-writer.md`. Keep that block current at every push, in the format AGENTS.md gives. Continue at the first milestone below that the notes do not mark done.

The quality bar is in `docs/fable/AGENTS.md` ("The quality bar for every agent"): evidence for every milestone, every new test shown to fail without its change, no weakened test, Firefox and WebKit fixed only when CI says so. The integrator sends back work that does not meet it.

## How you work

- Branch: `fable-writer` only. First `git fetch origin && git merge origin/fable` (never rebase, never force-push, no new branches). Push `fable-writer` after every task commit. The integrator merges it into `fable`.
- Commit subjects short, git style. Trailer lines as in OWNERSHIP.md rule 5 (leave out `Claude-Session` if your session has no URL).
- No code comments. Lint 0 and unit 0 failures before every push.
- Notes: `docs/fable/lanes/NOTES-writer.md` (a table of item, commit, verified) and your `MESSAGES-writer.md`. Last line of the notes when you stop: `HAND BACK <commit hash>`.
- Never wait for the integrator. Work the queue below from top to bottom. An item that needs a file you do not own gets the exact change written in your notes and you move to the next item.

## Your files

The `writer` row in `docs/fable/ownership.json`: `src/core/pq/**`, `src/core/vba/**`, `src/batch/execute/changes.js`, `src/batch/execute/replace.js`, `scripts/make-excel-pack.mjs`, `scripts/make-excel-kit.mjs`, `scripts/read-excel-results.mjs`, the writer tests (`batch-pq-members`, `batch-vba-members`, `batch-writer-*`, `batch-replace`, `batch-align`, `batch-save`, `pq`, `vba`, `vba-validate`, `wb-outline`, `excel-pack`, `excel-pack-claims`), `docs/fable/excel-pack/**`, your progress, messages and handover files.

Not yours: `src/core/save.js` and `src/core/sheet/**` (Scope), `src/batch/resolve/**` and `transform.js` (Scope), `src/batch/recipe/**`, `src/batch/execute/index.js`, `collect.js`, `run-file.js`, `src/app/**`, workers, `strings.js`, the manifest, baselines.

## Decisions on your questions

1. Your `writer` row: accepted and widened to the list above.
2. `connect`: stays opt-in in the core. No recipe field and no `executeFile` wiring until the user reports pack 3 case 02 from real Excel (decision D6). Commit `30e7599` is accepted, including its three lines in `src/batch/execute/index.js` and the 39 lines in `tests/unit/batch-execute.test.js`: those two files are the integrator's and the integrator takes your edits as they are. From now on you write such a change in your notes instead.
3. Your finding 1 (the sheet writer's touched parts are exempt from every check) is being built on `fable` by Scope, who owns `src/core/save.js` and `src/core/sheet/**` (milestone S1): declared insertions, the count-attribute fix from finding 5, and your nine probes ported as unit tests. You do not edit those files. When it is on `fable`, review it (milestone W4).

4. The second pack (W1, "the second pack cannot be built on `fable`"): yes. The pack tests held code (in place, Excel computes on open) that is not in the tree on purpose, so it is built where that code is and shipped as a file. Build it from `fable-scope` at `a73dd99` in a scratch worktree (`git worktree add` under a temp folder, never in your clone's tree, nothing committed from it except the zip), check its SHA-256 equals the one in your notes, and commit the zip under `docs/fable/excel-pack/` (your row). The kit uses it by default when `--scope-zip` is not given, and a test checks the committed zip's SHA-256 and that the kit reads it, so the `todo` goes. Scope is not asked to do this. Nothing else from `a73dd99` comes into the tree.

## Milestones (replace the old queue; work them in this order, do not wait for me)

Each milestone has a deliverable you can show and a test that proves it. Push `fable-writer` at the end of each milestone and add one line to `docs/fable/lanes/NOTES-writer.md` (milestone, commit, evidence). When a milestone is blocked by another owner, do the next one and come back.

**W1. The Excel sitting kit.** The user will run both Excel packs in one sitting (decision D6) and then tell the project what happened. Make that sitting short and its result machine-readable:
- `scripts/make-excel-kit.mjs`: runs `scripts/make-excel-pack.mjs` and `scripts/make-excel-pack-scope.mjs` (as separate processes, by command line, no import of Scope's file) and writes one zip: one `START-HERE.md`, one combined `CHECKLIST.md` in the order the cases should be opened, one folder per case with input and output, and one empty `RESULTS.csv` with a row per case and the columns `case, opened_without_repair, queries_ran, macros_ran, output_looked_right, note` and a first row for the Excel edition and version
- `scripts/read-excel-results.mjs <RESULTS.csv>`: reads the filled file and prints the exact wording for `docs/observations.md` and the README sentence about real Excel, claiming only what the filled cells justify (an empty cell is "not checked", never "yes"), and a list of cases that failed with their pack and checklist step
- tests `tests/unit/excel-kit*.test.js`: the kit lists every case once, both packs are in it, `RESULTS.csv` has one row per case, an empty results file claims nothing, a partly filled one claims only those cases
- Acceptance: tests pass; `node scripts/make-excel-kit.mjs /tmp/kit.zip` produces a zip you unzip and read as if you had only desktop Excel; say in the notes what you changed in `START-HERE.md` after doing that.

**W2. Writer sequences, randomized.** Seeded random sequences (length 1 to 6) of query and module operations (add, replace, remove, rename, replaceText, align) over every Excel-made and XlsxWriter workbook in `tests/fixtures`, through `executeFile`. Invariants: a result that is not a refusal reopens with Quoin's reader; every part the operation did not declare is byte-identical; `verify` accepts it; a refusal writes nothing; applying the same plan to the same input twice gives the same bytes. New file `tests/unit/batch-writer-fuzz.test.js`, 300 seeded cases, seed printed in any failure. Acceptance: passes and breaking one invariant in `changes.js` makes it fail.

**W3. Hostile inputs.** For every fixture that holds a compound file (`vbaProject.bin`) or a `DataMashup`: truncate it at 60 evenly spread lengths, flip a bit at 60 spread positions, and set each length and sector field in turn to its extreme values. Invariant: the result is a refusal with a code or a normal result; never an uncaught `TypeError` or `RangeError`; never longer than 2 seconds; never a growing output. New file `tests/unit/pq-hostile.test.js` (and `vba-hostile.test.js` if the VBA reader needs its own). Fix what it finds in your files; request the rest in the notes. Acceptance: passes, the notes list the defects found.

**W4. Review of the sheet gate.** When Scope's S1 is on `origin/fable` (its notes end S1 with a commit hash, or `src/core/sheet/` has `insertions` in `add-sheets.js`): merge `origin/fable`, run `docs/fable/excel-pack/repro-sheet-gap.mjs` and your corpus tests against it, and write what you find as exact requests for Scope in `MESSAGES-writer.md`. A probe that is accepted is a defect. Do W1 to W3 first; this one waits for S1, nothing else does.

**W5. Close the loop.** Your notes: a table of every check in `pq/**` and `vba/**` with its test; everything you found in W2 and W3 that belongs to another owner; then `HAND BACK <hash>`.

**W6. Browser tests for the writer features (plan F2-04 to F2-09).** The plan asks for browser tests of module replace, replace in code (with a pathological regex) and align, and the refusals of query remove and rename are checked in units only. New files `tests/e2e/fable-writer-*.spec.js` (your row), each through the real screens: drop the fixture files, load a recipe, Preview, Get, read the downloaded zip. One spec per feature: (1) query remove: a loaded query is refused with `query is loaded` in Preview and Get and nothing is written, an unloaded one is removed and the written zip no longer has it; (2) query rename: refused when another query references the name, changed when none does; (3) module replace across files: a module text that `validateModuleText` rejects blocks that row and shows the line and reason, the other files still land; (4) replace in code: plain text over M and VBA, then a regex such as `(a+)+$` over a long `aaa...!` line ends that file as `failed` with `m.timeout`, the page stays responsive and the next file in the queue is processed; (5) align: files with the same query name and a different hash get `replace`, files without that query are `skipped`. Fixtures come from `tests/fixtures`; the helpers in `tests/e2e/helpers.js` are read only (ask for additions in your notes). Run each on Chromium with `npx playwright test <spec>` where your session can; otherwise push and read `ci.yml`. Acceptance: every spec passes on `ci.yml`, each fails when the feature is switched off once in a scratch copy (record which line you broke in the notes), no existing test changed.

Blocked and not yours to unblock: real Excel for both packs, making `connect` the default.

## Ruled out

- Making `connect` the default, or wiring it into the recipe.
- Marking anything verified in Excel. The user's pack 1 result is "opened without repair, queries and VBA ran, outputs not reviewed" and nothing more.
- Editing a file outside your row, even for a one-line fix.
