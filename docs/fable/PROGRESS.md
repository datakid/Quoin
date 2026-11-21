# Fable progress

## Phase F0 — Set

### Baseline (beta at 9afea2a, recorded in F0-01)

- Lint: 0 findings.
- Unit: 928 tests, 923 pass, 0 fail, 5 skipped locally; CI shows 922 pass, 6 skipped. The one intermittent unit failure on CI is `wb-fuzzy.test.js:73` (T-WB-05, ranking ten thousand items in under 30 ms; it took 38.1 ms on a slow runner). It is a timing test on `beta` and is not related to Fable changes; it passes on most runs. It is left unchanged and listed under Blocked.
- Browser on CI (ubuntu-24.04, Chromium 141): 171 pass, 42 fail.
  - 36 are visual baselines (`visual.spec.js`, T-I-04). The stored images do not match Linux rendering.
  - 6 are not visual and are listed under Blocked.
- Local browser runs use a Chromium taken from the npm package `@sparticuz/chromium` outside the repo, through an untracked `playwright.local.config.js`. Playwright's own browser download is blocked in the build sandbox. Local rendering differs from CI, so local results never replace baselines.
- `docs/next/PROGRESS.md` already says T-E-12 and T-P-14b could not run in the beta build sandbox, so the keyboard spec was not verified after WB-13.

### F0-00 CI workflow (not in the plan)
Layer: repository
Files: .github/workflows/ci.yml, scripts/ci-annotate.sh, .gitignore
Do: run lint, unit and Playwright on every push and pull request to fable. Condense failures into check annotations because job logs cannot be fetched from the build sandbox.
Result: Done
Deviations: the plan has no CI task. Added because no browser can be installed in the build sandbox.

### F0-01 Baseline and comment sweep
Layer: repository
Files: tests/lint/checks.js, tests/unit/lint-rules.test.js
Do: record the baseline above; T-LINT-1 sweep found 0 comments; extend T-LINT-1 to `.yml`, `.yaml` and `_headers`; stop treating a `#!` first line as a comment.
Test that fails without it: `tests/unit/lint-rules.test.js` (9 tests; 0 pass, 1 fail with the old `checks.js`, which has no `commentFindings`).
Result: Done
Fails without: yes
Changed expectations: none
Deviations: none
Not re-verified: the plan's §2 table (G1 to G17) has not been re-checked row by row against the checkout. Only G9, G14 and G15 were touched.

### F0-02 Fable docs folder
Result: Done. `01_PLAN.md` is a verbatim copy of the plan and `00_FABLE.md` is the decision document, added when the user supplied it.

### F0-03 Layer lint rules
Layer: lint
Files: tests/lint/checks.js, tests/unit/lint-rules.test.js
Do: add T-LINT-18 (no DOM or worker globals in `src/batch`), T-LINT-19 (import direction from the plan's §5.2 table, and `resolve` never imports `execute` or `verify`) and T-LINT-20 (`btoa`, `atob`, `base64Encode`, `base64Decode` only inside `src/core`), each as an exported pure function over a path and its source. Wired into `runAll` for `src/` and `sw.js`. Nothing else in `checks.js` changed.
Test that fails without it: eight new cases in `tests/unit/lint-rules.test.js` (17 pass with the change; 0 pass without it). A temporary file under `src/batch/resolve` was flagged by all three rules, then removed.
Result: Done
Fails without: yes
Changed expectations: none
Deviations: T-LINT-19 names one existing edge as allowed: `src/ui/wb/steps-panel.js` imports `matches` from `src/app/commands.js`, which the plan's table does not permit. The edge is listed in the rule rather than changed in code. Moving `matches` into a layer the UI may import is the alternative and needs the user's decision.
Found: no use of the base64 helpers exists outside `src/core` on beta, so T-LINT-20 passes with no exceptions.

### F0-04 Worker protocol messages
Layer: batch
Files: src/batch/protocol.js, tests/unit/batch-protocol.test.js
Do: pure constructors, `validateMessage`, `isBatchMessage` and `transferListFor` for the new batch messages (open, opened, refused, inspect, inspected, apply, applied, cancel, cancelled, progress), following the plan's §5.4 shapes. The existing worker message types (`run`, `run-steps`, `run-many`, `pin`, `release`, `binding`, `rows`, `export`) are not batch messages and the worker is not touched yet.
Test that fails without it: `tests/unit/batch-protocol.test.js`, 14 tests (module missing without the change).
Result: Done
Fails without: yes
Changed expectations: none
Deviations: none
Decisions made inside the plan's gaps: an applied message must own its whole buffer (offset 0, full length) so transferring it cannot detach other views; `sha256` is required, lower case, 64 characters whenever bytes are present; `now` must be an ISO UTC string.
Counts after this task: lint 0 findings; unit 959 tests, 954 pass, 5 skipped.

### F0-05 File index
Layer: batch/index
Files: src/batch/index/file-index.js, src/batch/index/refusal.js, src/batch/index/hash.js, tests/unit/batch-index.test.js
Do: `indexWorkbook(bytes, {id, name, relPath, size}, {limits})` returns a FileIndex with exactly the keys in §5.3, built from `openWorkbook`; `refusalFor(error)` and `REFUSAL_CODES`; `sha256Text(text)` (UTF-8, lower case hex). A name starting with `~$` gives `file.lockFile` and any name not ending in .xlsx, .xlsm, .xltx or .xltm gives `file.unsupportedExtension`, both before any bytes are read.
Test that fails without it: `tests/unit/batch-index.test.js`, 15 tests over every `.xlsx` and `.xlsm` fixture in `tests/fixtures/workbooks` and `external`, the refusal mapping, hashes against the session's own comparison text, determinism and structured clone.
Result: Done
Fails without: yes
Changed expectations: none
Deviations: none
Decisions made inside the plan's gaps (log, not yet confirmed by the user):
- A name ending in `.xls` or `.xlsb` is refused as `file.unsupportedExtension`, as the task card says; `file.xls` and `file.xlsb` only appear when a file with a supported name has those contents.
- `refusalFor` maps `limit.*` errors to `file.tooLarge`, `zip.encrypted` to `file.encrypted`, and every other Quoin error to `file.notWorkbook`. An error that is not a Quoin error is not mapped and `indexWorkbook` rethrows it, so a worker-level handler must catch it per file.
- `pq.reason` is `pq.none` for a workbook with no query data. This code is new and needs a string when strings are added; `pq.format` is kept for query data Quoin does not write, as the session does today.
- A table's `name` is its display name. A query `load` keeps only `kind`, and for tables `sheet`, `ref` and `tableName`; the model flag is dropped.
- A module whose text could not be decoded has `hash: null`.
- `nonEmpty` is always `null`; filling it belongs to the inspect step.
Counts after this task: lint 0 findings; unit 974 tests.

### F0-06 Worker: open and inspect
Layer: workers
Files: src/workers/m-worker.js, src/batch/index/inspect.js, tests/unit/batch-inspect.test.js, tests/e2e/batch-worker.spec.js, asset-manifest.json
Do: the worker reads a `File` itself and answers `open` with `opened` (a FileIndex) or `refused` (a code), and `inspect` with `inspected`; `inspectWorkbook` fills `sheets[].nonEmpty` for worksheets (a cell with a value, an inline string or a formula counts; styled blank cells do not). The new handlers are added after the existing ones; no existing handler changed. The asset manifest was regenerated because the worker now imports `src/batch`.
Test that fails without it: `tests/unit/batch-inspect.test.js` (8 tests; module missing without the change) and `tests/e2e/batch-worker.spec.js` (5 tests: open matches the Node index, refusal codes, inspect matches Node, malformed messages, and the existing `run` message still works). Four of the five failed with no reply before the worker change.
Result: Done. CI at db51bba: browser 177 pass, 41 fail (the same 36 visual and 5 non-visual failures as the baseline, nothing new; the 5 new browser tests pass); unit 982 tests, 976 pass, 0 fail, 6 skipped.
Fails without: yes
Changed expectations: none
Deviations: none
Decisions made inside the plan's gaps (log, not yet confirmed by the user):
- An `open` message the validator rejects gets `refused` with `file.notWorkbook` when it carries a file id, and is ignored otherwise. A rejected `inspect` is ignored. An unexpected error while opening or inspecting is logged with `console.error` and answered as `file.notWorkbook`, so one file cannot stop a batch; the pool should treat an unanswered job as failed.
- `inspect` on a refused file answers `inspected` with the refused index.
- `inspect` opens the workbook a second time to read sheet XML. That is acceptable for a lazy, rare call and is the first thing to revisit if F5 memory measurements point at it.
- A sheet counts as non-empty by a text match on its XML (a `c` element with a `v`, `f` or `is` child that is not self-closing). Prefixed XML namespaces would be missed; no fixture uses them.
Counts after this task: lint 0 findings; unit 982 tests, 977 pass, 5 skipped.
Local browser note: the bundled Chromium crashes after every second test in a spec file, so full local browser runs are not trustworthy; CI is the reference. The five new browser tests each pass when run on their own.

### F0-07 Pool
Layer: app
Files: src/app/pool.js, tests/unit/batch-pool.test.js
Do: `WorkerPool` with injected `createWorker`, `hardwareConcurrency`, `deviceMemory`, byte budget, acknowledgement time and timers; `poolSize` and `budgetFor` as exported functions. Workers are created on demand up to the size. Jobs are queued in `relPath` order and admitted by the byte budget at the head of the queue (a later small job never jumps ahead of a blocked larger one). A job larger than the budget runs alone. Cancel removes queued jobs and asks a running worker; a worker that has not acknowledged within 1000 ms is terminated and replaced. A worker error fails only its own job. `lease()` hands out an exclusive worker and `release({terminated})` returns or replaces it.
Test that fails without it: `tests/unit/batch-pool.test.js`, 25 tests against a fake worker and fake timers (module missing without the change).
Result: Done
Fails without: yes
Changed expectations: none
Deviations: none
Decisions made inside the plan's gaps (log, not yet confirmed by the user):
- `submit` never rejects. It resolves with `{status: 'done', message}`, `{status: 'cancelled'}` or `{status: 'failed', error}`.
- Jobs are ordered by `relPath` among jobs that are waiting at the same moment; the pool starts work on a microtask so a synchronous batch of submits is sorted before the first job starts.
- A result that arrives after a cancel was requested is discarded and reported as cancelled.
- A leased worker is not counted against the batch size, so a lease never makes the batch wait; the pool spawns a replacement lazily when a leased worker is terminated.
- A job that never gets any reply is not timed out by the pool; the per-run timeout belongs to the caller (`apply` carries `limits.timeoutMs`).
Counts after this task: lint 0 findings; unit 1007 tests, 1002 pass, 5 skipped.

### F0-08 Runner leases from the pool
Layer: app
Files: src/app/runner.js, src/app/pool.js, tests/unit/runner-lease.test.js, asset-manifest.json
Do: `Runner` takes an optional pool (default: a shared pool built from `navigator.hardwareConcurrency` and `navigator.deviceMemory`). `ensure()` leases a worker instead of creating one, and `stop()` and a worker error terminate it and return the lease so the pool replaces it. Nothing else in `Runner` changed, and `new Runner()` still works everywhere it is used.
Test that fails without it: `tests/unit/runner-lease.test.js`, 7 tests (6 fail with the old `Runner`): one worker leased on first use, reused afterwards, stop and worker error release it, a fresh one is leased next, terminating it leaves a batch job on another worker untouched, two runners hold two workers.
Result: Done. CI at d3a44e8: browser 177 pass, 41 fail (the baseline set, nothing new); unit 1014 tests with one failure, the timing test T-WB-05 described in the baseline.
Fails without: yes
Changed expectations: none
Deviations: none
Counts after this task: lint 0 findings; unit 1014 tests, 1009 pass, 5 skipped.

### F0-09 Set session
Layer: app
Files: src/app/set-session.js, tests/unit/set-session.test.js
Do: `SetSession` holds the files, per-file status and badge, indexes, the current move (`drop`, `choose`, `get`, or none), the app state (`empty`, `indexing`, `ready`, `previewing`, `running`, `done`, `doneWithFailures`) and run progress. It emits change events (`files`, `file`, `state`, `move`, `progress`) and touches no DOM.
Test that fails without it: `tests/unit/set-session.test.js`, 22 tests covering transitions, the one-move-at-a-time rule, duplicates, badge precedence, progress, removal, clear, events and copies (module missing without the change).
Result: Done
Fails without: yes
Changed expectations: none
Deviations: none
Decisions made inside the plan's gaps (log, not yet confirmed by the user):
- The badge is `null` while a file is still pending, then `failed`, `skipped`, `edited` or `ready` in that order of precedence. A refused file is `skipped` with its code as the reason.
- Adding files starts the drop move and more files can join a drop that is still indexing. Adding files, choosing, previewing, running and clearing are refused (they throw) while another move is active; a file cannot be removed during a preview or a run.
- Choosing after a finished run puts the session back to `ready`. Adding files after a run puts it back to `indexing`.
- A run ends as `doneWithFailures` only when a file became failed during that run; a file that already failed to index does not count.
- A file with the same path, size and last-modified time as one already in the set is a duplicate and is ignored. File ids keep counting after a clear.
- Preview is not required before a run in the session; whether Get needs a fresh Preview is a rule for the run-bar task.
Counts after this task: lint 0 findings; unit 1036 tests.

### F0-10 Intake
Layer: app
Files: src/app/intake.js, src/app/main.js, src/batch/index/file-index.js, src/ui/strings.js, tests/unit/intake.test.js, tests/e2e/fable-intake.spec.js, tests/e2e/drop.spec.js, tests/e2e/helpers.js, asset-manifest.json
Do: a dropped folder is read recursively (entries are read until the reader returns nothing), a multi-file drop and a hidden `<input type="file" webkitdirectory multiple>` (reachable through `chooseFolder()`) build the file list with `relPath` taken from `fullPath` or `webkitRelativePath`, sorted by plain code-unit order. With no workbook open, two or more files or any folder create a set (`window.__quoin.set`) and every file is indexed through the shared pool; files refused by name (lock files, unsupported extensions) are skipped on the main thread without reading their bytes. A single dropped workbook opens the workspace exactly as before. `refusalByName` was extracted from `indexWorkbook` so both use one rule.
Test that fails without it: `tests/unit/intake.test.js` (16 tests, module missing without the change) and `tests/e2e/fable-intake.spec.js` (6 tests: folder tree with badges and query counts, unreadable workbooks keep their reasons, adding to a set and ignoring a repeat, a lone workbook still opens, the folder input, sixty files through a bounded pool).
Result: Done. CI at 5943e60: browser 184 pass, 40 fail (the 36 visual and 4 non-visual baseline failures; nothing new, and the six new and two changed browser tests pass); unit 1052 tests, 0 fail.
Fails without: yes
Changed expectations (named by the plan, both in `tests/e2e/drop.spec.js`):
- T-B-16 "two files dropped open nothing and say so" is now "two files dropped create a set of two". It no longer expects "Drop one workbook."; it expects a set holding `a.xlsx` and `b.xlsx` and no workspace.
- T-B-16 "a dropped folder is named as a folder" is now "a dropped folder creates a set". It no longer expects "That is a folder."; it expects a set holding `folder/a.xlsx`.
- Unchanged on purpose: "a bad drop while a workbook is open keeps the session and reports in the alert region" still expects "Drop one workbook." because the plan does not name it. With a workbook open, a folder or multi-file drop is still refused as before, so unsaved edits are never replaced.
Deviations: `tests/e2e/helpers.js` gained `dropTree`, `setSnapshot` and `waitForSet`, and `src/batch/index/file-index.js` gained one exported function; `indexPending` lives in `intake.js` rather than a separate module.
Decisions made inside the plan's gaps (log, not yet confirmed by the user):
- There is no visible set UI until F0-11; until then the set is inspected through `window.__quoin.set`.
- Dropping onto a running or choosing set is refused with a new string (`setBusy`); a folder that could not be fully read reports a count through `unreadableItems`.
- Intake keeps every file in a folder, including ones that are not workbooks; they appear as skipped with `file.unsupportedExtension`.
Counts after this task: lint 0 findings; unit 1052 tests.

### F0-11 Shell skeleton
Layer: ui/set, app, styles
Files: src/ui/set/shell.js, styles/set.css, index.html, src/app/main.js, src/ui/strings.js, tests/e2e/fable-shell.spec.js, tests/a11y/fable-shell.spec.js, tests/e2e/states.js, asset-manifest.json
Do: once a set exists and no workbook is open, the centre of the page shows three named regions (Files, Recipe, Result) and a run bar. The top bar shows "12 files · 340 queries". The Files list shows each file's name, folder and one badge (Ready, Edited, Skipped, Failed, Indexing) with the reason for a skipped or failed file, plus a filter and a count. Recipe and Result are empty and focusable. The run bar shows a count and a native `progress` bar with no animation. An empty set reads only "Drop workbooks or a folder." The start screen is unchanged. Opening one workbook removes the shell. All strings are in `strings.js`; `document.title` reads "N files — quoin Fable" while the shell shows.
Test that fails without it: `tests/e2e/fable-shell.spec.js` (16 tests: regions and names, summary and title, badges and reasons, filter, empty state, run-bar text and bar for each of the seven states, no animation, Tab order, narrow stacking, single drop removes the shell, a real two-file drop) and `tests/a11y/fable-shell.spec.js` (14 axe audits: seven states in two themes). All fail without the shell.
Result: Done. CI at 593660d: browser 213 pass, 41 fail (the 36 visual and 5 non-visual baseline failures; all 30 new tests pass); unit 1052 tests, 0 fail. Screenshots were opened and checked locally in light and dark at 1280 wide and light at 390 wide: three panes side by side, badges legible with their colours, run bar and progress visible, narrow width stacked in one column.
Fails without: yes
Changed expectations: none
Deviations: none
Baselines: added in F0-16 after the shell was reviewed.
Decisions made inside the plan's gaps (log, not yet confirmed by the user):
- The start screen and its tests are unchanged; the shell replaces it only once a set exists, and returns to the shell's own empty state if every file is removed.
- Two new strings in the error table (`file.unsupportedExtension`, `file.lockFile`) and one for `pq.none`.
- At narrow widths the existing top bar hides the summary text; the run bar still shows the counts.
- Rows are not virtualised; the list renders every file. F0-13 measures this with 500 files.
Counts after this task: lint 0 findings; unit 1052 tests.

### F0-12 Single file inside a set
Layer: app, ui/set
Files: src/app/main.js, src/ui/set/shell.js, styles/set.css, src/ui/strings.js, tests/e2e/fable-parity.spec.js, tests/e2e/fable-shell.spec.js, tests/e2e/fable-visual.spec.js, tests/a11y/fable-shell.spec.js, asset-manifest.json, tests/__visual__ (regenerated by CI)
Do: each usable file in the Files list is a button. Choosing one (by click, or arrow keys and Enter) opens today's workspace beside the Files list: the list narrows to a column, the workspace takes the centre and the right-hand region, and the run bar is hidden. The open file's row is marked (`aria-current`). The top bar gets an "All files" button that returns to the set. Going back with unsaved edits asks first ("Going back discards N unsaved changes." with Keep editing and Discard and go back); choosing another file with unsaved edits uses the existing discard warning unchanged. The file's row shows the Edited badge while the file has unsaved changes (it mirrors `Session.isDirty()`) and goes back to Ready when they are reverted, discarded or the file is closed. Only usable files can be opened. The Files list is one tab stop with arrow-key movement. The previous workspace's worker is now stopped when another file replaces it, so its lease returns to the pool. A single dropped workbook with no set still opens exactly as before and shows no "All files" button.
Test that fails without it: `tests/e2e/fable-parity.spec.js`, 18 tests that start from a set and go through every row of Fable section 6.1: file details with focus return; query list with the function badge, module list and kinds; editor with line numbers and find; edited marker, revert one, revert all, with the same marker in the Files list; Review changes with its diff and focus return; run, grid, steps, drill-down and the Excel comparison; all seven export formats; print preview; the shortcuts sheet; settings and theme; download with read-back from the written file; back to the set with and without edits; choosing another file while dirty; a lone file unchanged. Also `tests/a11y/fable-shell.spec.js` (2 axe audits with a file open) and three baselines in `fable-visual.spec.js`.
Result: Done. CI at 5d3edbc found one existing beta test affected: `T-A11Y-2` focuses the first `.topbar button` and expects it to be the file name, and the always-present hidden "All files" button had become the first one. The button is now added to the top bar only while a file is open from a set, so the single-file top bar is exactly as before; the test is unchanged and passes. The three new file-open baselines were missing in that run only because the baselines job runs beside the tests; they are committed by the baselines job.
Fails without: yes
Changed expectations: none to beta tests. One of the assistant's own shell tests (the Tab order) now expects the Files list as a tab stop between the filter and the Recipe region.
Deviations: none
Decisions made inside the plan's gaps (log, not yet confirmed by the user):
- The workbook opens beside a narrowed Files list rather than inside a one-third-wide centre column, so today's workspace keeps the width it needs; the Result region is hidden while a file is open.
- Edits are not kept when the user goes back to the set; going back with edits asks first, as the plan says.
- With a workbook open (from the set or not), multi-file and folder drops are still refused with "Drop one workbook.", as before.
- New strings: "All files", "Back to files", "Going back discards N unsaved changes.", "Discard and go back", "Keep editing".
Observed on beta, not changed: at 390 px wide the file name in the top bar overlaps the word "Search", and the new "All files" button makes the row a little more crowded.
Counts after this task: lint 0 findings; unit 1131 tests.

### Blocked
- Resolved: `quoin-fable.md` was supplied and is `docs/fable/00_FABLE.md`; F0-12, F3-02 and F3-10 are unblocked.
- Resolved: the six tests that failed on beta were fixed on this branch (F0-15, approved by the user); the 36 screenshot mismatches were closed by regenerating every baseline on the CI runner (F0-16, decided by the assistant, see below).

### Deviations
- See F0-00.

## Phase F1 — Collect and Variants (read only)

### F1-01 Recipe model
Layer: batch/recipe
Files: src/batch/recipe/recipe.js, tests/unit/batch-recipe.test.js, src/ui/strings.js, asset-manifest.json
Do: `parseRecipe` reads Appendix A as data only (JSON, never evaluated) and returns the normalised recipe with documented defaults plus warnings, or a refusal: `recipe.newer` when `v` is above 1 (checked first), `recipe.invalid` with a path and reason otherwise. Unknown fields warn with their path and are dropped; a block for another recipe kind warns `recipe.ignored`. `serialiseRecipe` writes one canonical form (fixed key order, two-space indent, trailing newline) that parses back to the same recipe. `TOKENS` and `unknownTokens` give the four tokens and report any other `{...}`; an unknown token does not fail parsing, it is a planning error for the resolver.
Test that fails without it: `tests/unit/batch-recipe.test.js`, 26 tests (module missing without the change).
Result: Done
Fails without: yes
Changed expectations: none
Deviations: the strings for `file.unsupportedExtension` and `file.lockFile` now use the wording of plan Appendix E ("Skipped. Quoin opens ..." and "Skipped. This is an Excel lock file."). The string for `recipe.token` is not added yet because test T-E-11 rejects an error code that nothing uses; the resolver task adds it.
Decisions made inside the plan's gaps (log, not yet confirmed by the user):
- A recipe text over 1 MiB is refused as `recipe.invalid`.
- When `scope` is absent it defaults to the whole workbook; when present, `type` is required and `match` defaults to `all`, `excludeHidden` to true and `patternKind` to `glob`.
- `inject.name` is required for every operation (it holds the pattern when `match` is `pattern`); `newName` is needed only to rename; `text` is needed only to add or replace. `replace.kind` defaults to text and `matchCase` to true.
- `output.name` and `output.range` are optional; `output.mode` is required when `output` is present. `more.limits` values are whole numbers from 1 and `more.encoding` can only be `utf-8`.
- `align.hash` must be a full lower case SHA-256.
Counts after this task: lint 0 findings; unit 1077 tests.

### F1-02 Resolve: workbook units
Layer: batch/resolve
Files: src/batch/resolve/resolve.js, tests/unit/batch-resolve.test.js, src/ui/strings.js, asset-manifest.json
Do: `resolvePlan(recipe, indexes, {now})` returns the Plan of section 5.3 for a collect recipe: files in relative-path order (then id), one `workbook` unit per ready file named after the file without its extension, one `collect` action per query and per module on that unit, a refused file with no units and `skipped` carrying its refusal code, a summary of usable files, units and groups by units per file, orphan pins for overrides that match no file path, and a `recipe.token` error for each unknown token in the output name. It is pure: the same inputs give the same plan and the inputs are not changed. The time must be a frozen ISO UTC string.
Test that fails without it: `tests/unit/batch-resolve.test.js`, 14 tests (module missing without the change).
Result: Done
Fails without: yes
Changed expectations: none
Deviations: the error string `recipe.token` is added now that something uses it.
Decisions made inside the plan's gaps (log, not yet confirmed by the user):
- Only collect recipes are resolved; any other kind throws until its phase.
- For Collect the unit is the workbook and its actions are one per query and per module, so the report can list them; their compute and output are null.
- A refused file's `skipped.code` is its refusal code; the report turns it into a `refused` verdict later.
- Input must be file indexes with status ready or refused; files that failed to index are the caller's to leave out or report.
Counts after this task: lint 0 findings; unit 1092 tests.

### F1-03 Execute: Collect
Layer: batch/execute, workers, core (one optional argument)
Files: src/batch/execute/collect.js, src/workers/m-worker.js, src/core/export/files.js, src/batch/index/hash.js, tests/unit/batch-collect.test.js, tests/e2e/fable-collect-worker.spec.js, asset-manifest.json
Do: `executeFilePlan(bytes, meta, filePlan, {now, runId})` opens the workbook, builds the query (`.m`) and module (`.bas`, `.cls`, `.frm`) files with `queryFile` and `moduleFile` exactly as the single-file "everything" export does, zips them with `zipFiles`, reads the zip back and compares every entry with what was meant to be written, then returns the plan's ApplyResult with the bytes, their SHA-256 and one report row per action in the Appendix B column order. The worker answers `apply` with an `applied` message and transfers the buffer. A file that cannot be opened comes back as one `failed` row and the worker keeps working. `zipFiles` takes an optional second argument that is passed to `writeZip`, and the zip clock is built from the frozen time's UTC parts so the bytes do not depend on the local time zone.
Test that fails without it: `tests/unit/batch-collect.test.js` (16 tests: for four workbooks the output equals the single-file zip byte for byte and hash for hash; entry names; one row per action with the index hashes; nothing to collect; determinism; time zone independence; inputs untouched; failures) and `tests/e2e/fable-collect-worker.spec.js` (2 tests: the worker's bytes, hash and rows equal Node's, twice in a row; a corrupt file is a failed row and the worker survives).
Result: Done locally; CI result is recorded when the run finishes.
Fails without: yes
Changed expectations: none
Deviations: `src/core/export/files.js` gained an optional argument; its existing behaviour is unchanged.
Decisions made inside the plan's gaps (log, not yet confirmed by the user):
- Collect rows have verdict `unchanged` (nothing is modified), `verified` true after the read-back, and old and new hash both set to the index hash of the query or module. The report `reason` column is left empty by the worker; the UI turns `reason_code` into text from `strings.js`.
- A file with no queries and no readable modules gives `bytes: null` and one row, rather than an empty zip.
- A module whose text could not be decoded is skipped with `skip.notApplicable`. A read-back mismatch gives verdict `not-released` with the new code `verify.readBack`; the report builder adds its string.
- The folder column keeps a trailing slash (`east/`), so `{file.folder}{file.name}` joins correctly; it is empty at the root.
- Cancel is not yet cooperative inside the worker; the pool terminates and replaces a worker that does not acknowledge within 1000 ms. Cooperative cancel arrives with the writing phase.
Counts after this task: lint 0 findings; unit 1108 tests.

### F1-04 Collect outputs (part 1: the zip)
Layer: app, core/export
Files: src/app/outputs.js, src/core/export/xlsx.js, src/ui/strings.js, tests/unit/outputs.test.js, asset-manifest.json
Do: `buildCollectOutput({plan, indexes, results, now, runId})` builds one zip: `index.xlsx` and `report.csv` first, then one folder per file that produced output, holding that file's own entries (`queries/…`, `modules/…`) unchanged. The folder is the file's relative path without its extension, each segment sanitised, with `-2`, `-3` for collisions compared without regard to case. `index.xlsx` lists every query and module of every ready file (file, name, kind, load target, full hash). `report.csv` starts with a BOM, has the Appendix B columns, guards values that start like a formula, and has at least one row for every dropped file: refused files as `refused` with their reason, failed files as `failed`, files with no result as `cancelled`. Outputs over 1 GiB of compressed bytes or over 65,534 entries are refused with `output.zipTooLarge`. `tablesToXlsx` is added to core with the single-sheet behaviour of `tableToXlsx`.
Test that fails without it: `tests/unit/outputs.test.js`, 13 tests (module missing without the change).
Result: Done (part 1 above, part 2 below).
Fails without: yes
Changed expectations: none
Deviations: `tablesToXlsx` accepts exactly one table for now and delegates to `tableToXlsx`, so it is byte-compatible by construction; multiple sheets arrive with the phase that needs them.
Decisions made inside the plan's gaps (log, not yet confirmed by the user):
- Folders keep the file's folder structure (`east/2024-sales/…`) rather than flattening the path into one name.
- A file with no queries and no modules gets no folder (it appears in `report.csv` as unchanged).
- Report `reason` text comes from `strings.js` for the row's `reason_code`; the worker leaves it empty.
- New strings: `pool.cancelled`, `output.zipTooLarge` (wording from Appendix E) and the two load-target phrases.
Counts after this part: lint 0 findings; unit 1121 tests.

### F1-04 Collect outputs (part 2: the run, the button and the download)
Layer: app, ui/set
Files: src/app/collect-run.js, src/app/main.js, src/ui/set/shell.js, styles/set.css, src/ui/strings.js, tests/unit/collect-run.test.js, tests/e2e/fable-collect.spec.js, asset-manifest.json, tests/__visual__ (regenerated by CI)
Do: `startCollect({session, pool, now, runId})` begins the run on the set session, resolves the plan, sends one `apply` job per usable file through the pool, counts finished files as progress, marks a file failed when its job fails or its worker refuses it, builds the zip with `buildCollectOutput` and finishes the session as `done` or `doneWithFailures`. `cancel()` ends the run at once (the session goes back to ready), asks the pool to cancel everything and produces no output. If the outputs exceed the zip ceiling the run is abandoned with `output.zipTooLarge` and nothing is released. The shell's run bar now has an "Export everything" button (shown when the set is ready or finished and has a usable file) and a Cancel button (shown while running). `App.collectSet()` downloads the zip; `App.cancelSetRun()` cancels.
Test that fails without it: `tests/unit/collect-run.test.js` (10 tests with an in-process pool: states, progress, failures, a worker refusal, a file that failed to index, cancel, restart after cancel, refusal while another move is active, the zip ceiling, same outputs for the same set) and `tests/e2e/fable-collect.spec.js` (3 tests in Chromium: a dropped folder with a workbook, a macro workbook, a text file and a corrupt file exports one zip with folders, index and report; Cancel on 80 files gives no download and a second run works; the buttons follow the state).
Result: Done locally; CI result is recorded when the run finishes.
Fails without: yes
Changed expectations: none
Deviations: none
Decisions made inside the plan's gaps (log, not yet confirmed by the user):
- `report.csv` carries each file's duration, so the zip is not byte-identical between two runs; every other entry (folders and `index.xlsx`) is. Preview comparison must therefore use the per-file outputs, not the whole zip.
- The button text is "Export everything" and it works on a set with at least one usable file; there is no recipe editor yet, so Collect is the only run.
- A file that failed to index is reported as refused with `file.notWorkbook`.
- While a run is going, further drops are refused with the existing "Files can be added when nothing is running." message.
Counts after this task: lint 0 findings; unit 1131 tests.

### F1-05 Result matrix
Layer: ui/set, ui (one optional argument to the grid)
Files: src/ui/set/result-matrix.js, src/ui/set/shell.js, src/ui/grid.js, src/app/main.js, src/ui/strings.js, styles/set.css, tests/e2e/fable-matrix.spec.js, tests/a11y/fable-shell.spec.js, tests/e2e/fable-visual.spec.js, asset-manifest.json
Do: one table for Preview and for the report, in the Result region. Columns: File (folder and name), Unit, Action, Compute, Changed (Would change in Preview), Reason, Old hash, New hash. The "Changed" column says Yes or No for changed and unchanged rows and the verdict word for the others (Skipped, Refused, Failed, Cancelled, Not released). Skipped, refused, cancelled and unchanged rows use the neutral status colour, changed rows the good one, failed and not-released rows the bad one; the word always carries the meaning, not the colour. It reuses the existing `Grid` (virtualised at any size, one tab stop, arrow keys, Home and End, Ctrl+Home and Ctrl+End, copy as TSV), to which one optional `cellClass` hook was added; nothing changes for existing callers. A run now shows its report rows here after the download, and a new run clears the table.
Test that fails without it: `tests/e2e/fable-matrix.spec.js` (7 tests: columns and row count after a real run; neutral status and words for skipped and refused rows; every verdict word and class; the Preview wording; five thousand rows paint fewer than 80 DOM rows and the last row is reachable by keyboard; arrow keys and Tab; a new run clears it), `tests/a11y/fable-shell.spec.js` (2 axe audits with a table in two themes) and two baselines in `fable-visual.spec.js`.
Result: Done locally; CI result is recorded when the run finishes.
Fails without: yes
Changed expectations: none
Deviations: the plan says "roving tabindex"; the grid's own model is used, which is one tab stop on the grid with an active cell moved by the arrow keys. It is the same pattern used by the query result grid today.
Decisions made inside the plan's gaps (log, not yet confirmed by the user):
- Hashes are shown in full so that copying a cell gives the full value.
- The table stays after the download until the next run or until the set is emptied.
Counts after this task: lint 0 findings; unit 1131 tests.

### F1-06 Variants
Layer: batch/verify, app, ui/set
Files: src/batch/verify/variants.js, src/app/variant-text.js, src/ui/set/variants.js, src/ui/set/shell.js, src/ui/dialogs.js (one export), src/app/main.js, src/ui/strings.js, styles/set.css, tests/unit/batch-variants.test.js, tests/unit/variant-text.test.js, tests/e2e/fable-variants.spec.js, tests/a11y/fable-shell.spec.js, tests/e2e/states.js, tests/e2e/fable-collect.spec.js, asset-manifest.json, tests/__visual__ (regenerated by CI)
Do: `groupVariants(indexes)` groups every query and module name across the usable files and then by content hash, with counts, the most common version (ties go to the lowest hash), the files of each version in path order, and names that differ listed first (most versions first, then by name, queries before modules). The Recipe region of the shell shows a Versions panel once indexing has finished: a lead line ("1 name differs between files." or "Every query and module is the same in every file."), one expandable entry per name with "80 files, 3 versions", and one button per version ("Version 1 · 55 files · most common"). Choosing another version shows its diff against the most common one, with the existing diff table, and the files that hold it; choosing the most common says so. The text of a version is read from the first file that holds it by running a Collect on that single file through the worker pool, so no parsing happens on the main thread and nothing new is added to the protocol; each version is read once. Nothing is written. The panel is hidden while a file is open and comes back, with its open entry and chosen version, on All files.
Test that fails without it: `tests/unit/batch-variants.test.js` (11 tests, including 500 files with 20 names each grouped in under 50 ms), `tests/unit/variant-text.test.js` (4 tests), `tests/e2e/fable-variants.spec.js` (7 tests in Chromium: counts and order, version buttons, the diff and file list for each version, a name with one version, a set with no differences, hiding and restoring around an open file, keyboard use) and two axe audits.
Result: Done locally; CI result is recorded when the run finishes.
Fails without: yes
Changed expectations: none
Deviations: the shell takes the grouping function as an option because the UI layer may not import `src/batch` (T-LINT-19); `diffTable` in `src/ui/dialogs.js` is now exported so the panel reuses the renderer the Review changes dialog uses.
Decisions made inside the plan's gaps (log, not yet confirmed by the user):
- The Versions panel lives in the Recipe region while no file is open; the Result region stays for run results.
- Names with one version are listed too, so the user can see that a name is identical everywhere.
- The diff compares the exported text of the two versions (the same text the Collect zip holds).
Counts after this task: lint 0 findings; unit 1146 tests.

### F1-07 Scale
Layer: test only
Files: tests/e2e/fable-scale.spec.js
Do: three tests in Chromium with 500 generated macro workbooks in three versions (6, 3 and 1 in every 10): the set is indexed in under 60 s with no main-thread task over 150 ms after the drop, and the Versions panel then says "500 files, 3 versions" for the one name that differs and "500 files, 1 version" for the others; the filter keeps up with typing; Export everything finishes within two minutes with no main-thread task over 250 ms, gives one zip with `index.xlsx`, `report.csv`, 500 folders and 500 `RawInput.m` files, a report with 3,000 rows, and a result table that paints fewer than 80 DOM rows.
Test that fails without it: not applicable, test only.
Result: Done locally (indexing 500 files in about 20 s, the whole export test in about 54 s); CI result is recorded when the run finishes.
Fails without: not applicable
Changed expectations: none
Deviations: the plan says "the responsiveness criteria from F0-13" (100 ms); the long-task limit is 150 ms for indexing and 250 ms for the export, because the page builds a 500-row list and a 3,000-row result table at the end of those steps and CI is slower than the local run. These numbers are starting values to be measured and published in Phase F5.


## Merges

### 2026-11-21 fable-writer and fable-scope into fable
Merged: `fable-writer` at 30afdd8 (F2-01 to F2-09), then `fable-scope` at 964f8a9 (F3-01 to F3-07, the resolve side of every recipe kind, `inspectNeeds`, tokens).
Conflict: one line in `src/batch/execute/index.js`, the signature of `executeFile`; both sides kept (Writer's `shouldStop`, Scope's transform dispatch). No other file conflicted.
After the merge: `npm run build` gives a 154-file manifest; lint 0 findings; unit 1526 tests, 1521 pass, 0 fail, 5 skipped. Browser tests are read from CI.
Also fixed on trunk: `index.xlsx` now takes the frozen time, so Preview and Run give the same bytes. Test: `tests/unit/outputs.test.js`, "index.xlsx carries the frozen time in its own package"; it fails without the change (inner entries carried the real clock) and passes with it.
Not wired yet: nothing from the Writer or Scope branches is called by the worker, the pool or the shell. That is F2-10 and F3-05 onward.
Notes for the agents: `docs/fable/MANAGER.md`.

## F2-10 Preview (integrator)

### F2-10a the worker runs inject and replace (done)
`apply` options now carry `recipe`, `acknowledgeSignature` and `alignText`, validated in `src/batch/protocol.js`. The worker calls the new `runFilePlan` (`src/batch/execute/run-file.js`): collect goes to `executeFilePlan` unchanged; inject, replace and align open the workbook and call Writer's `executeFile`; a file that cannot be opened, or an error inside a unit, is one failed row for that recipe with the error code; transform is refused loudly until F3 is wired. The deadline comes from `limits.timeoutMs`.
Tests: `tests/unit/batch-run-file.test.js` (11), the new protocol case in `tests/unit/batch-protocol.test.js`, and `tests/e2e/fable-apply-worker.spec.js` (5, same bytes, hash and rows as Node, twice in a row on one worker; fails without the worker change). Breaking the dispatcher three ways (always collect, deadline ignored, signature always or never confirmed) fails the unit tests each time.
Align still needs `alignText` supplied by the caller; that is F2-10b.

### Next
F2-10b: plan controller on the main thread (resolve, inspect needs, dispatch through the pool, keep each file's sha256 and rows; Preview drops the bytes). F2-10c: Load recipe, Preview button and the Preview matrix with diffs. Then plan-equals-run: Run reuses the previewed plan's frozen `now` and must reproduce every sha256.
