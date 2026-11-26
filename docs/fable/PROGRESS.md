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

### F2-10b the plan controller (done)
`src/app/plan-run.js` `startPlanRun({ mode: 'preview' | 'run', ... })` for inject, replace and align. It resolves the plan, refuses one with errors (`plan.invalid`), runs one job per file through the pool, and returns rows in plan order with each file's sha256 (`hashes`), counts per verdict and `signedCount`. Preview drops the bytes, never marks a file failed, and always runs with the signature confirmation on so the matrix shows `signature_removed` rows. A run needs the preview: it reuses the preview's frozen `now`, refuses `plan.stale` when the set changed, `vba.confirmNeeded` (with the count) until `confirmSignatures`, and holds a file back (`verify.planDrift`) when its hash differs from its preview hash. A file that crashes in a run is a failed row and badge, not a divergence. `build` is an optional hook for the F2-11 output step; `session.finishRun` waits for it. Align reads the chosen version's text through `loadAlignText` (the variant text loader). `set-indexes.js` now holds the index helper that Collect also uses, and `reportRows` is exported from `outputs.js`.
Verdicts a row can have: changed, unchanged, skipped (query or module absent, `skip.notApplicable`), refused, failed, cancelled.
Tests: `tests/unit/plan-run.test.js` (15). Breaking the controller seven ways (bytes kept, run ignores the frozen time, divergence unchecked, stale unchecked, signature confirmation skipped, preview marking a file failed, preview not run with the confirmation on) fails a test each time.
New result codes that F2-10c must give strings: plan.invalid, plan.stale, verify.planDrift (was plan.diverged, see F2-11), vba.confirmNeeded, align.unreadable.
Follow-up in F2-10c: the begin-preview and begin-run state changes and the early refusals now happen when `startPlanRun` is called, so a second preview while one is going throws at the call instead of returning a rejected promise. One more test (`tests/unit/plan-run.test.js`, 16 now) fails without it.

### F2-10c the screen (done)
The Recipe pane has a recipe panel above Versions (`src/ui/set/recipe-panel.js`): Load recipe (a file input, 256 KB cap, `parseRecipe`), Remove recipe and Preview. The panel shows the kind and file name, unknown-field notes, one error line (role alert) and a status line with the counts and the signed-project notice. A failed load drops the recipe that was loaded before it, so Preview never runs a recipe the screen no longer shows. Collect and transform recipes load but cannot be previewed yet (a note says so).
Preview runs `startPlanRun` through the shared pool; the result goes to the Result matrix in `preview` mode (header "Would change"). Cancel shows while previewing. The preview is dropped, and the table with it, when a recipe is loaded or removed, when files are added (state `indexing`), and when the shell is rebuilt. After a run or a collect has finished, Preview moves the session back to `ready` through the existing choose move (`beginChoose` and `endChoose`).
Reasons now read in words: 25 codes were added to `ERRORS` (skip.*, refused.*, align.*, verify.readBack, pool.failed, plan.*, vba.confirmNeeded, recipe.patternAdd, output.failed). T-E-11 still holds and every key is used.
Tests: `tests/e2e/fable-preview.spec.js` (13), two axe cases in `tests/a11y/fable-shell.spec.js` (preview and error, light and dark). Breaking the screen four ways (no focus restore, stale preview kept on indexing, plan problem shown as a code, a failed load keeping the old recipe) fails a test each time; the first run of the last one survived, so the invalid-recipe spec now loads a good recipe first. The `landmark-unique` axe finding on the first draft was fixed by making the panel a plain container.
Visual baselines for the Set shell will differ in CI because the Recipe pane has a new block. CI regenerates them; nothing was edited by hand.
When Trunk's `src/app/recipe-files.js` (F4-01) lands, `loadRecipeFile` in `main.js` should call it instead of its own size check.

### F2-11 Get, and F2-12 signed projects (done, one confirmation for the set)
Drift is per file, as the plan says (`verify.planDrift`): when a file's run hash differs from its preview hash, that file is not released (no bytes, its rows read "Not released", the badge shows failed), the other files are released, and the result carries `defect: true` and `diverged: [ids]`. This replaces my first version, which aborted the whole run with `plan.diverged`; that broke the rule that one bad file never stops a batch. The status alert and the panel say how many files were held back.
A cancel while the outputs are being built used to throw from `finishRun`; `startPlanRun` now passes `{ shouldStop }` to the build hook and returns `{ cancelled: true }`. A second preview or run while one is going throws at the call.
Outputs (`src/app/outputs.js`, `src/app/folder-output.js`): the run zip is `report.csv` first, then each changed workbook at its own sanitised relative path (case-insensitive clashes become `-2`, `-3`), named `Inject|Replace|Align YYYY-MM-DD.zip` from the frozen preview time, so the same run gives the same bytes. Files that did not change, and files held back, are not in it. The `output` column names where each changed file went. `verified` and `signature_removed` read `yes` or `no` in the report (the plan says `yes`); the Collect report now does too, and no test pinned `true` or `false`.
Folder output (browsers with `showDirectoryPicker`): each workbook is written with `createWritable`, aborted on error, read back and compared, removed if it differs, and never written over an existing file (the new name gets `-2`, and the report names the name actually used). A source file is never opened for writing; the app only holds `File` objects. A stop request ends the write between files; a failure keeps what was written and reports `output.folderFailed`; a picker that fails for a reason other than the user closing it says the folder could not be opened. The folder button is hidden where there is no picker.
Signed VBA (F2-12, Q3): Preview always shows `signature_removed` and the panel says how many files would lose their signature. Get asks once, naming the count ("1 workbook has a signed macro project..."), with Remove and get / Go back. Go back changes nothing. The run refuses (`vba.confirmNeeded`) without the confirmation.
Screen: Get appears only after a preview with something to change; it and Get into a folder become the primary action then. After a run, the table switches to the report, the preview is used up (Get is hidden), and Preview is available again. Adding files, loading or removing a recipe drops the preview, so a stale plan cannot be run (and `plan.stale` still guards the controller).
Tests: `tests/unit/plan-output.test.js` (16: six zip mutations and five folder mutations each fail a test), `tests/unit/plan-run.test.js` (18), `tests/e2e/fable-get.spec.js` (10), axe for Get, the dialog and after Get in both themes, and a visual state for a previewed recipe. Breaking `main.js` three ways (confirmation skipped, preview kept after a run, picker failure swallowed) fails a test; the third one survived the first spec and now has its own case. The dark axe case failed one run in six because the Preview button was fading to primary while axe sampled it; the a11y cases for this panel now run with reduced motion, as the visual ones do.
Not done: Run in place (Scope's F3-08) and the output modes for transform (F3-05 to F3-07) are not reachable from the screen. They wait for the real-Excel check.

### F2-10d the per-row diff (done)
Select a row in the preview and the area under the table shows what that row would change: the title (`Replace · Module1 · books/signed.xlsm`), then the same line diff the Versions panel uses (`diffTable`). A rename row says "Renamed from A to B." A row that does not change, or that has no text to show, goes back to "Select a row to see what changes." The area is a focusable region labelled "Changes to <name>" and is the only thing that scrolls inside it. The area is only there in a preview; the report after Get has none.
How the text gets there: `apply` takes a new option `includeTexts`, validated in `protocol.js`; `executeFile` records `texts: { before, after }` on each query and module change and strips them again unless asked, so a run never carries text and a preview never carries bytes. `startPlanRun` asks for texts in preview only. `src/app/row-diff.js` `rowDiff(result, index)` finds the change that belongs to a row by file path and then by action and the two hashes (the nth match when a file has several identical ones). `Grid` has a new `onActive(r, c)` option and `ResultMatrix` an `onSelectRow(r)` option.
Found on the way: a plain click on a grid cell left the grid in drag mode, so every re-created row under a still pointer extended the selection and repainted again, forever (about 700 DOM changes in a second, still going). It was already in `Grid`; the row selection made it visible. Fixed in `src/ui/grid.js`: a pointer entering a cell without the primary button down ends the drag, and `extend` does nothing when the selection would not change.
Tests: `tests/unit/batch-texts.test.js` (6), `tests/unit/row-diff.test.js` (8, including a hand-built two-file case that fails when the file lookup is wrong), the `includeTexts` cases in `batch-protocol.test.js` and `plan-run.test.js`, `tests/e2e/fable-row-diff.spec.js` (9), a drag test in `fable-matrix.spec.js`, axe for the hint and the diff in both themes. Breaking the code six ways (texts always kept, texts never asked for, wrong file chosen, drag guard removed, `extend` repainting, drag never ending) fails a test each time.
The visual baseline of the previewed recipe changes (the hint line); CI regenerates it.

### F1-08 Phase F1 gate (section 9)
Evidence is from CI on `fable` at `4261657` (run 44947148629: lint 0 findings; unit 1,539 tests, 0 failing; browser 333 passing, 0 failing) and from the tasks above.
- [x] `npm test` is green: lint 0 findings; unit and browser green on CI at the commit above. The unit timing test T-WB-05 failed once on a slow runner at a later commit (30.4 ms against 30); it now takes the best of 25 runs with the limit unchanged.
- [x] Every new test was shown to fail without its change: recorded in F1-01 to F1-07. The read-only test was also checked by deliberately calling `showSaveFilePicker` in the run, which made it fail.
- [x] No existing test was weakened, skipped or deleted in Phase F1. Changed expectations: none. One of the assistant's own shell tests (Tab order) was widened twice because the Files list and the Versions panel became tab stops.
- [x] Every new surface has a keyboard path, axe checks in both themes, and reviewed baselines: result table (arrow keys, Home, End, Ctrl+Home, Ctrl+End; axe in two themes; baselines in two themes), Versions panel (keyboard test; axe in two themes), Export everything and Cancel (buttons). Baselines were opened and reviewed; one defect was found in review (the Changed column cut off in the Result region) and fixed by widening the region while a table is showing.
- [x] No new dependency (`package.json` unchanged), no network call, no new storage key (T-LINT-4, T-LINT-8 green), no base64 or binary data persisted (T-LINT-20 green).
- [ ] The vertical slice works by hand in Chromium: walked through in Chromium by a script with screenshots viewed (drop a folder, see Ready and Skipped, open the Versions panel, Export everything, see the result table); a person has not done it. Left open for a person.
- [x] README, `docs/decisions.md` (entry 25) and PROGRESS.md are updated.
- [x] F1: 500 files are indexed in under 60 s (about 20 s locally; `fable-scale.spec.js` passes on CI).
- [x] F1: drift is grouped by content hash (`batch-variants.test.js`, `fable-variants.spec.js`, and the 500-file test).
- [x] F1: nothing is written (`fable-readonly.spec.js`: no write API call, source files byte-identical).
Result: Phase F1 gate passed, except the by-hand slice, which a person still has to do.

F2-10d: the per-row diff when a row is selected (old text from the variant loader, new text from the recipe or the replace matches). Then F2-13 (`fable-cancel.spec.js`, `fable-failures.spec.js`) and F2-14 (`fable-batch50.spec.js`), which are test-only, then the F2-16 gate.


### F4-01 Save and load recipe files (pure part)
Layer: app (pure module, not wired)
Files: src/app/recipe-files.js, tests/unit/recipe-files.test.js
Do: `saveRecipeFile(recipe)` returns the canonical text, its UTF-8 bytes and a file name made from the recipe name (`Fix sales.quoin-recipe.json`; the recipe kind when there is no name), or refuses with `recipe.binary` (a typed array, buffer, Blob, function, symbol or bigint anywhere in the recipe, with its path), `recipe.invalid` (with the reason) or `recipe.tooLarge` (over 256 KB). `loadRecipeFile(file)` checks the size before reading, refuses binary content (a NUL byte, a control character or invalid UTF-8) with `recipe.binary`, strips a byte order mark, and hands the text to `parseRecipe`, so `recipe.invalid`, `recipe.newer` and the warnings come through. `isRecipeFileName(name)` recognises the suffix in any case. A recipe is only ever parsed as data.
Test that fails without it: `tests/unit/recipe-files.test.js`, 13 tests (module missing without the change). Deliberately removing the control-character check made the zip-magic case fail.
Result: Done
Fails without: yes
Changed expectations: none
Deviations: none; the module is not wired into the app (that is the integrator's lane).
Counts after this task: lint 0 findings.

### F4-03 Stored recipes and recent sets (pure part)
Layer: app (pure module), lint, privacy test
Files: src/app/recipe-store.js, tests/unit/recipe-store.test.js, tests/lint/checks.js, tests/unit/lint-rules.test.js, tests/e2e/privacy.spec.js, README.md
Do: `createRecipeStore(storage)` takes an injected storage object. It keeps recipes under `quoin.recipes` (a list of name and canonical recipe text; at most 50 recipes and one million characters; same name replaces, ignoring case) and the names of recent sets under `quoin.recent` (at most 10, newest first, no duplicates, no path separators, no control characters, at most 80 characters). It never throws: unreadable or corrupt storage lists nothing, a write that fails returns `recipe.storeFull` or `recent.store`, and a stored recipe from a newer version is skipped when listing but kept when saving. It writes only those two keys. T-LINT-8 is now a pure function with the exact three-key allowlist (`quoin.theme`, `quoin.recipes`, `quoin.recent`). T-PRIV-3 keeps its original test (only the theme after ordinary use) and gains one that saves a recipe and remembers a set, then expects exactly the three keys, a recent list that holds only `Q3 sales` (a name with a path in it is refused), and no file name, path or workbook content anywhere in storage. The README privacy sentence names the three keys.
Test that fails without it: `tests/unit/recipe-store.test.js` (18 tests), two new T-LINT-8 tests in `tests/unit/lint-rules.test.js`, and the new T-PRIV-3 test. Deliberately breaking the case-insensitive replace and the path check each made a test fail.
Result: Done locally; the module is not wired into the app.
Fails without: yes
Changed expectations: T-PRIV-3 as the plan names it; its original assertion is kept as its own test. T-LINT-8 accepts three keys instead of one, as the plan names it.
Deviations: none.
Decisions made inside the plan's gaps (log, not yet confirmed):
- Recent sets hold names only, with no timestamps.
- The key check in lint applies to direct `window.localStorage` calls; the store gets its storage by injection and is restricted to its two constants at run time and by the privacy test.

### Notes for the integrator: wiring F4-01 and F4-03
- Save: a Save recipe button in the Recipe region calls `saveRecipeFile(recipe)` and downloads `out.bytes` as `out.name` with the app's existing `saveBytes` (type `application/json`). Load: an input accepting `.json`, and a drop of one file whose name passes `isRecipeFileName`, call `loadRecipeFile(file)`; on `ok` put `out.recipe` in the form and show `out.warnings`.
- Stored recipes: `createRecipeStore(window.localStorage)` once in `main.js`. `saveRecipe`, `listRecipes`, `deleteRecipe`, `rememberSet`, `recentSets`, `clear` return plain data. When a set is created call `rememberSet(name)` with the dropped folder's own name (never a path) or a short label such as "12 files".
- Strings to add to `src/ui/strings.js` when the code that uses them lands (T-E-11 rejects unused keys): `recipe.tooLarge` ("This recipe file is larger than 256 KB."), `recipe.binary` ("This is not a text file."), `recipe.name` ("Give the recipe a name before saving it."), `recipe.storeFull` ("Quoin cannot keep more recipes here. Delete one, or save it as a file."), `recent.name` and `recent.store` (not shown to people; may stay as codes).
- Regenerate `asset-manifest.json` when these files are first imported by the app.

### F2 test cards and what they found (done)
`fable-plan-equals-run.spec.js`: seven recipes (replace in code, query replace, query replace by pattern, query add, module replace, module add, module remove) plus align. For each, a 1.2 s wait between Preview and Get, then every file in Get's zip hashes exactly as Preview said, the zip holds exactly the changed files and report.csv, and no row is `not-released`. Helpers shared by the new specs are in `tests/e2e/fable-batch.js`.
`fable-inject.spec.js` (9): add, replace, remove, rename across three workbooks; the old hash in a Preview row is the hash the index had, the new hash is the hash of the file Get writes; outputs reopen with every other query and module unchanged; refusals read in words and take Get away; no file is opened for writing and no picker is used for a zip.
`fable-cancel.spec.js` (4): a zip stopped mid-run downloads nothing and the preview and Get survive; a folder stopped between files leaves only complete files whose hashes are in the preview, opens nothing afterwards and writes no report; stopping during the workers writes nothing; the same preview can be got again in full.
`fable-failures.spec.js` (4): encrypted, `.xlsb` (by extension and by content), `.xls`, junk, zip bomb, path traversal, bad CRC, a text file and a lock file among three good workbooks. Everything unreadable is skipped with its own reason, the good ones are planned and released, and report.csv (zip and folder) has a row for every file in the set.
`fable-batch50.spec.js` (2): fifty workbooks in five folders; every output has the same parts as its input, differs only in the declared parts (one customXml part for a query change, only `xl/vbaProject.bin` for a module change), and carries exactly the unit hashes the preview named. Preview takes about 1 s and Get about 0.6 s locally.
Defects these found and fixed:
- Aligning a class or document module (ThisWorkbook, a sheet, a form) always failed with `align.sourceChanged`: the text read back from the collected `.cls`/`.frm` file carries the export header or footer that the index hash does not include. `moduleSourceOfFile` (beside `moduleFile`) undoes it and the variant text loader uses it for modules. Known gap: a module with characters outside ASCII is read as UTF-8 although the file is written in the project's code page, so such a module still fails the align check (safe: the file is refused, nothing is written).
- A file the rule did not match (`skip.notApplicable`) was reported as `refused`; it is `skipped`.
- A refused row that carried a detail showed only the bare detail ("StudentResults!StudentResults") in the table and in report.csv; it now reads the sentence followed by the detail in brackets (`reasonWords`).
- A stopped Get gave no feedback and left the preview table empty. It now shows the preview again and says how many workbooks were written to which folder, or that nothing was written or downloaded. The run guard stays until the stopped run has finished the file it was writing, so a second Get or Preview cannot overlap it.
- A plain click on a grid cell left drag mode on and the grid repainted in a loop (see F2-10d).
Known flaky tests, not ours: `T-WB-05` (30.4 ms against a 30 ms budget) and `T-WB-09` in `run-modes.spec.js` (one CI run saw "2 ran, 1 item edited" where it expected "Nothing to run"; 40 of 40 local runs pass).

### F2-15 the real-Excel pack, version 1 (done by the integrator)
`node scripts/make-excel-pack.mjs [out.zip]` writes `quoin-excel-pack.zip` (ignored by git; default in the current folder). It holds `CHECKLIST.md`, then `cases/NN-name/input/` and `cases/NN-name/output/` for 13 cases and 18 output workbooks (17 at first; the 18th, `output-no-bindings.xlsx` in case 01, was added later): query replace, query add (a workbook with queries, and the Excel-made `ms_template_query.xlsx`), query remove and rename (on the workbook Quoin just added a query to), module replace, add and remove, a signed project (generated, and the real `xw_macro04.xlsm`), replace in code (VBA and M), and Scope's three output modes (new file per unit, new sheet in a copy, combined workbook). Every case lists what to open and what to look at in Excel; each has a pass box and a fail box. Nothing is marked verified; the person who runs Excel ticks the boxes. The checklist ends with the SHA-256 of every output, so a report can be tied to a file.
The script calls the executor directly and fails loudly if a case changes nothing or refuses. `tests/unit/excel-pack.test.js` checks: 13 case folders each with an input and an output, 18 outputs that all open with Quoin and are listed with their hash, no ticked box, and the same bytes when made twice.
Gaps: there is no password-protected macro project fixture, so writes to a protected project are not in the pack (Quoin refuses them). In place (F3-08) is not in the pack and stays unmerged until the three modes above have a human pass.

### F2 screenshots walked, and one layout defect (done)
A script took the drop, recipe loaded, Preview, row picked and Get screens in light and dark at 1280 wide and in light at 390 wide, and the images were opened. Desktop is as intended. On a phone the Recipe pane's Versions list ran over the Result pane (and the run bar over the list): the stacked layout from F0-11 squeezed three rows into one screen and left the content overflowing. It was already there with a recipe loaded; the diff area made it worse. Fixed in `styles/set.css`: below 900 px every row is as tall as its content, the shell scrolls, and a table gets 70vh. After Preview the result is scrolled into view (`revealResult`, called once the recipe notes and focus are settled; called earlier it was undone by the notes growing). Test: `fable-row-diff.spec.js`, "on a phone the panes stack without covering each other and the result and diff come into view" (no sideways scroll, no pane spilling, panes in order, result and diff inside the shell after Preview and after picking a row). Putting back the old rows, or removing the reveal, fails it. The phone baselines change; CI regenerates them.

### F2-16 Phase F2 gate (section 9)
Evidence is from CI on `fable` at `13c3b0a` (run 45169086735: lint 0 findings; unit 1,630 pass, 0 fail, 6 skipped; browser 403 passed, 0 failed) and from the tasks above. The phone layout fix above came after it; it is covered by its own test and by CI on the next push.
- [x] `npm test` is green: lint 0 findings; unit and browser green on CI at the commit above. Not repeated here: the oracle tests that need Python tools are skipped, as on beta.
- [x] Every new test was shown to fail without its change: recorded in F2-10d and in the test cards. Mutations were also run by hand and each failed a test: the per-row diff six ways (F2-10d), skipped against refused in both directions, the grid drag guard, and the phone row sizing and the scroll to the result.
- [x] No existing test was weakened, skipped or deleted in Phase F2. Changed expectations: none. Three existing test files had an import line widened (`errors.test.js`, `export.test.js`, `tests/a11y/fable-shell.spec.js`).
- [x] Every new surface has a keyboard path, axe checks in both themes, and reviewed baselines: Recipe panel (buttons; axe), Get dialog for signed projects (focus trap and return; axe), diff area (focusable region that scrolls; arrow keys follow the row; axe in two themes for the hint and the diff). Screenshots were opened (above); one defect was found and fixed. Baselines for these screens are regenerated by CI after the push that changes them.
- [x] No new dependency (`package.json` unchanged), no network call, no new storage key (T-LINT-4, T-LINT-8 green), no base64 or binary data persisted (T-LINT-20 green).
- [ ] The vertical slice works by hand in Chromium: walked through by a script with screenshots viewed (drop three workbooks, load a recipe, Preview, pick a row and read the diff, Get a zip, report); a person has not done it. Left open for a person.
- [x] README, `docs/decisions.md` (entry 26) and PROGRESS.md are updated.
- [x] F2: a 50-file batch is byte-exact (`fable-batch50.spec.js`): every output differs from its input only in the parts the recipe declares, and carries the hashes the preview named.
- [x] F2: Preview equals Run (`fable-plan-equals-run.spec.js`, seven recipes and align); a difference would make the file not released.
- [x] F2: cancel leaves no partial file (`fable-cancel.spec.js`); one bad file does not stop the queue (`fable-failures.spec.js`).
- [x] F2: the real-Excel pack, version 1, has been built and handed to the user.
- [ ] Real Excel opens every output. Not done and not claimable from here: nothing in this environment can run Excel. This blocks F3-05 to F3-08.
Result: Phase F2 gate passed, except the by-hand slice and the real-Excel check, which a person has to do.

### F3-05 Transform wired in the app: a new file per unit (done, unverified in Excel)
Do: a Transform recipe whose output mode is `newFile` can be previewed and got. Only this mode is wired; `newSheet`, `combined`, `inPlace` and compute-in-Excel recipes say plainly that they cannot be previewed yet, and stay that way until a person has opened the pack in Excel (F3-06 to F3-08 wait for it by the plan). The engines for them are already on `fable` and untouched.
- Worker path: `runFilePlan` accepts `transform` and replies with `outputs` (name, unit, bytes, sha256) and no whole-file bytes; a preview sends hashes only. The protocol validates `outputs` and lists each output buffer once in the transfer list.
- `plan-run`: a file's hash in a transform is a digest of its output names and hashes, so the plan-equals-run check works the same way: a difference marks that file not released and drops its outputs.
- `outputs`: each output goes next to where its source was, named by the plan (`pq_simple__StudentNames.xlsx`), `-2` before the extension on a case-insensitive clash; each report row names its own path, and a changed row whose file was held back now shows an empty output (it used to keep the name). The zip is `Transform {date}.zip`; folder output writes the same paths.
- Picking a transform row names the file it would write and says what is in it (`Writes books/pq_simple__StudentNames.xlsx, a workbook with one sheet, Result, holding the values of StudentNames.`); the region is focusable and passes axe in both themes. Left out on purpose: showing the table a unit would produce in Preview.
Test that fails without it: `tests/e2e/fable-transform.spec.js` (10 tests: picking a row names its file; a row per unit with its file; Get's zip has one workbook per unit and each hashes as Preview said; each workbook has one sheet, Result, holding the unit table; the zip holds nothing else; folder output; the three other output modes and compute-in-Excel refuse with their reason), `row-diff.test.js` (transform rows), `tests/a11y/fable-shell.spec.js` (two audits), `plan-run.test.js` (support table, preview rows, a run equals its preview, a drifted output is not released), `plan-output.test.js` (zip paths, case clash, held-back unit, folder), `batch-protocol.test.js`, `batch-run-file.test.js`, and `excel-pack.test.js`: the pack's new-file outputs are byte for byte what the app writes for the same time, so what a person checks in Excel is what the app produces. Eight mutations were run and each failed a test.
Changed expectations (two existing unit tests assumed Transform was unwired): `plan-run.test.js` "only inject, replace and align can be previewed" now says a new-file transform can and the other three cannot; `batch-run-file.test.js` "a recipe kind that is not wired yet is refused" now uses an unknown kind.
Flaky test fixed on the way: CI at `5d2e601` failed `outputs.test.js` "tablesToXlsx with one table is byte-compatible with tableToXlsx" (not related to this change). It compared two workbooks built without a fixed clock, and the zip stores seconds, so the two calls differing by a second made the bytes differ. The test now passes the same fixed clock to both; what it asserts is unchanged.
Real Excel: not checked. The pack's `new-file` case is the one to open first.

### Verified without Excel, and what only Excel can settle (integrator)
Why: the person has no Excel today, so every output in the pack was checked with tools that are not Quoin.
- Checked and passing: all 14 pack inputs and all 18 outputs against an independent structural checker (zip entries, content types per part and per relationship, relationship targets, worksheet element order, shared strings, table parts, DataMashup framing). The checker was calibrated on inputs Excel itself wrote (it must pass them) and on mutated outputs (it must fail them); one mutation was missed until the per-relationship content-type check was added.
- openpyxl loads every input and output.
- LibreOffice converts every output, and the values match the sources: new-file StudentNames is Name and Age with Alice 30, Bob 25, Charlie 35; StudentResults adds a real date in `DateTimeGenerated`; the new-sheet output has `Result` and `Result-2`; the combined output has three sheets.
- DataMashup parsed a second time outside Quoin (MS-QDEFF framing): version 0, package, permissions, metadata and bindings lengths add up with nothing left over, and the package bytes of an output equal its input's when the recipe does not change them.
- Microsoft's Open XML SDK validator (CI only, `.github/workflows/openxml.yml`, SDK 3.1.0, Microsoft 365 schema): 32 files (14 inputs, 18 outputs), 0 findings in any file, including the Excel-made `ms_template_query.xlsx` and the macro workbooks. It is not trusted on that alone: the job first validates a deliberately broken copy (an unknown element in a worksheet) and fails unless that is reported; it is (`Sch_InvalidElementContentExpectingComplex`). It checks the schema of the parts it knows; it does not read the query data, and it is not Excel. It is a separate workflow from `ci` so it cannot hold up the main checks; nothing was added to the repo's dependencies.
- Added: `output-no-bindings.xlsx` in case 01. It is `output.xlsx` with `PermissionBindingsLength = 0` and differs in `customXml/item1.xml` only (a test and the independent parse both say so). If Excel shows a repair message on `output.xlsx`, this file says whether the stored bindings are the cause (QUOIN_SPEC MX-3 names this as the fallback).
- Not settled and not claimable from here: that Excel opens any output with no repair message; that Excel accepts the unchanged PermissionBindings after an M edit; that a refresh runs; the new-sheet, combined and in-place modes in Excel; whether Excel shows a trust prompt for an injected query. Those are the checklist rows.

### Real Excel, first report (from the person, 2026-11-24)
What the person said: the 13 files opened without a single file repair message; the queries and the VBA ran without errors; they did not review the contents of the outputs and did not tick the checklist.
What it settles: the pack's outputs open in real Excel with no repair or recovery message (the one pass that mattered most), and a refresh and the macros run. The 13 are taken to be one output per case, as the pack is laid out; which of case 01's two files was opened was not said, so `output-no-bindings.xlsx` is not shown to have been needed.
What it does not settle: that the new sheets and files hold the right values in Excel (the LibreOffice and openpyxl reads say they do), the per-row lines of `CHECKLIST.md`, and anything about in place or Excel-computes-on-open, which the pack has no case for.
Taken as the gate for F3-06 and F3-07 by the integrator, because case 12 (new sheet) and case 13 (combined) are among the files that opened clean. F3-08 and F3-09 stay held. Not ticked in the checklist: nothing is marked verified there.

### F3-06 Transform wired in the app: a new sheet in a copy (done, opened clean in Excel by the person, contents not reviewed)
Do: a Transform recipe whose output mode is `newSheet` can be previewed and got. Each source workbook gives one copy beside it, `{file} (edited).{ext}`, with every original sheet kept and one new sheet per unit (`Result`, `Result-2`), made by the same change writer the replace path uses. The engine was Scope's; this is the wiring.
- `previewSupport` accepts `newSheet`. The note for combined and in place now reads "Only a new file for each unit, or a new sheet in a copy, can."
- A report row names its output as `copy [Sheet]`. That format now has one source (`sheetOutput` and `splitSheetOutput` in `changes.js`, used by the new-sheet and the combined code), and `fillOutputs` turns the copy's name into its released path and keeps the sheet (`a/one (edited).xlsx [Result]`). Before this, a new-sheet row would have shown no output.
- Picking a row says `Writes books/pq_simple (edited).xlsx, a copy of the workbook with a new sheet, Result, holding the values of StudentNames.`
- A file's hash in a transform is still the digest of its output names and hashes, so plan equals run holds; a drifted copy is not released and its rows name no output. Copies whose names differ only by case get `-2` before the extension; a folder output never overwrites a file that is already there.
Test that fails without it: `plan-run.test.js` (preview rows, run equals preview, the copy keeps every sheet and adds Result and Result-2 for a plain and a signed macro workbook, drift), `plan-output.test.js` (zip holds the copies, rows name the sheet, case clash), `row-diff.test.js`, and `tests/e2e/fable-transform-sheet.spec.js` (5: preview rows, picking a row, Get's zip hashes as Preview said and the report names path and sheet, the copy keeps every source sheet cell for cell and adds the unit tables, a macro workbook copy keeps its VBA project byte for byte). Mutations run, each failed a test: the path mapping for the sheet suffix (6 tests), the sheet in the row detail (1 unit and 1 browser test), and the mode not being previewable (4 tests).
Changed expectations (three existing tests assumed new sheet was not wired): `plan-run.test.js` "only inject, replace, align and a transform that writes a new file per unit ... can be previewed" and "previewSupport says why" (new sheet now ok); `fable-transform.spec.js` refusal table lost its new-sheet row and the combined and in-place wording gained the new-sheet words.
Not checked: an xlsm copy in real Excel (the pack's new-sheet case is a plain xlsx); a signed project copy keeps its signature part and the report does not mark it removed, which is untested in Excel.

### F3-07 Transform wired in the app: one combined workbook (done, opened clean in Excel by the person, contents not reviewed)
Do: a Transform recipe whose output mode is `combined` can be previewed and got. All the units of all the files go into one `Combined.xlsx`, a sheet per unit in plan order (the sheet is named from the recipe's name template; the default is `{file}__{unit}`), written at the root of the zip or the chosen folder.
- Worker: a preview now sends each sheet part's digest and no sheet xml (`sheetParts[].xml` is null); a run sends the xml. The protocol validates `sheetParts`.
- `plan-run`: a file's hash in a combined preview is a digest of its sheet names and grid digests, so plan equals run holds per file. After the per-file runs, a preview labels each row `Combined.xlsx [sheet]` (`labelCombined`), and a run calls `combineOutputs` once across the files that were not held back, patches each row with the workbook name, sheet and hash, drops the sheet xml, and returns `combined` (name, bytes, hash, sheet names). A file that drifted is left out and its rows read `not-released`. If no unit made a table there is no workbook and the zip holds `report.csv` alone.
- `outputs` and `folder-output`: the combined workbook is one more released file, with `-2` if its name is taken; a row's `Combined.xlsx [sheet]` becomes the released path plus the sheet.
- Picking a row says `Writes Combined.xlsx, one workbook with a sheet for every unit; the sheet pq_simple__StudentNames holds the values of StudentNames.` The note for the one mode still not wired, in place, reads "Only a new file for each unit, a new sheet in a copy, or one combined workbook can."
Test that fails without it: `plan-run.test.js` (5: preview rows and hashes with no xml; the run releases one workbook with the sheets in plan order and the rows name its hash; the run is byte for byte what `combineOutputs` makes from the same files in plan order; a drifted file is left out; no tables means no workbook), `plan-output.test.js` (3), `row-diff.test.js`, `batch-protocol.test.js`, `batch-run-file.test.js` (preview digests equal the run's), and `tests/e2e/fable-transform-combined.spec.js` (4: preview rows, picking a row, Get's zip with the workbook, its sheets and values and the report's path, sheet, hash and verified columns, folder output at the root). Four mutations were run and each failed tests: the combine step skipped (4), the workbook not released (4), the per-file digest ignored (2), and the row detail placed beside the source (1).
Changed expectations (existing tests assumed combined was not wired): `plan-run.test.js` "only inject, replace, align and a transform ... can be previewed" and "previewSupport says why"; `fable-transform.spec.js` lost its combined refusal row and the in-place wording gained the combined words.
Order: sheets follow the plan, which sorts files by path, so the app's order can differ from the order of case 13 in the pack (the pack lists `pq_simple` before `plain_table`). The code is the same; only the sheet order differs.
Not checked: a combined workbook with a very long sheet name, or many files, in real Excel.

### F3-10 The section 9 worked example (done: browser test passes; three differences from the wording)
Do: `tests/e2e/fable-worked-example.spec.js` drops twelve workbooks, loads one recipe, previews and gets, and asserts the numbers. The data comes from `tests/fixtures/worked-example.js` (a helper, which Scope was asked for and had not built): four workbooks with a `Data` sheet, three with `Data` and `Notes` (pinned to `Data` by three overrides), three with two sheets, and two `.xls`. Two of the two-sheet workbooks have a second sheet with no `Amount` column. The recipe is Transform, scope all sheets, output new sheet `Clean`, query `CleanSales` (promote headers, select `Region` and `Amount`).
Asserted and passing: 12 files in, 2 marked skipped, 10 ready; Preview states "7 files → 1 unit each, 3 files → 2 units each — 13 units across 10 files"; 13 unit rows, 11 changed, 2 failed with "The column 'Amount' of the table wasn't found." shown on the row; the three pinned files have one unit each; Get is a zip of 10 workbooks and a report; every workbook's hash is the one Preview computed; each copy keeps every source sheet cell for cell and adds `Clean` (and `Clean-2` for the one two-sheet workbook with both sheets good), every changed row reads verified. Not asserted: that Excel opens the result (the new-sheet kind is among the files the person opened clean).
New in the app for this: Preview shows the plan summary line for Transform recipes (`S.planSummary`; the plan already computed it). Mutations run, each failed the test: the summary line removed, and one override removed (numbers moved to 6, 4, 14 and 3 failed).
Differences from section 9, for the person to decide (nothing was changed to hide them):
1. Section 9 says the two rows whose query names a missing column are "skipped with reasons". The engine reports them as `failed`, with the reason in words. Nothing in the M engine tells "a column is missing" from any other error by code (only by message), and calling a data problem "skipped" would make it look like nothing was wrong. If skipped is wanted, the engine needs a code for it first.
2. Section 9 counts 13 rows. There are 13 unit rows, plus one row for each of the two `.xls` files (verdict `refused`, shown as `skipped` on the file in the Files list), so the report has 15 lines.
3. Section 9 says the two excluded rows' files "fall back to inject only". A new-sheet transform has no inject step to fall back to; those files still release a copy with the sheets that worked, and the failed rows say why. Not built.
Changed expectations: none.

### Conflict markers in this file, and a lint rule (integrator)
The trunk agent's merge of `fable` (`b81065b`) committed `docs/fable/PROGRESS.md` with a leftover `=======` and `>>>>>>> origin/fable`, and a stale paragraph from before F2 was finished. The markers are gone. T-LINT-22 (`tests/lint/checks.js`, with a test) now fails on a line that starts with `<<<<<<< ` or `>>>>>>> ` in any source, test, config or docs file; it flagged the bad file before the fix. A heading underline of `=======` is not flagged. The stale paragraph beginning "F2-10d: the per-row diff when a row is selected" is the trunk agent's old plan line and is left for them to remove.

### F4-01 and F4-03 wired: save, download and reuse a recipe (done, tests pass locally)
Layer: app, ui, strings, styles, tests
Files: src/app/main.js, src/ui/set/recipe-panel.js, src/ui/set/shell.js, src/ui/strings.js, styles/set.css, tests/e2e/fable-recipes.spec.js, tests/e2e/app.spec.js, tests/a11y/fable-shell.spec.js
Do: the Recipe panel loads a file through the trunk agent's `loadRecipeFile` (size check, binary check, byte order mark, `parseRecipe`), so a file that is too big, not text, not JSON or from a newer version is refused in words. With a recipe loaded the panel offers Save in this browser (the store from F4-03, under `quoin.recipes`) and Download recipe file (`saveRecipeFile`, named `{name}.quoin-recipe.json`). A recipe with no name of its own is kept under its file name without the suffix. A Saved recipes list appears once there is one: Use puts it in the panel as if it had been loaded from a file (and clears the old preview), Delete removes it and moves focus to the next item, or to the Load button when none is left. A stored recipe that cannot be read is counted and left out ("1 saved recipe could not be read and is left out."), and is never deleted.
Test that fails without it: `tests/e2e/fable-recipes.spec.js`, 8 tests: Save and Download show only once a recipe is loaded; a saved recipe is listed, survives a reload, and Use loads it so it can be previewed; an unnamed recipe is kept under its file name and saving again replaces it; Download writes a named file that loads back to the same recipe; Delete moves focus to the next item or to Load recipe; an unreadable stored entry is left out and counted while the rest list; a file that is not text is refused in words and a file over 256 KB still is; after use, local storage holds only the theme and recipe text, never a path, a workbook or a query from one. Deliberately removing the file-name fallback, the focus move and the skipped note each made one test fail. T-A11Y-FABLE gains the same panel with a saved recipe listed, light and dark: no axe violations.
Result: Done locally
Fails without: yes
Changed expectations: the home footnote. It said "Files stay in this tab. Nothing is uploaded or stored." and now says "Files stay in this tab. Nothing is uploaded or stored, except your theme and the recipes you choose to save." QUOIN_SPEC PR-5 and the start screen drawing, `tests/e2e/app.spec.js` and the string changed together. The old sentence stopped being true once a recipe could be saved. T-E2E-1 still checks the footnote text.
Deviations: recent sets (`rememberSet`, `recentSets`) are deliberately not wired. The list would show names of folders a person opened, with nothing to do with them: there is no way to reopen a folder from a name in a browser that gives the page no path. Showing them would imply an ability the app does not have. `quoin.recent` stays in the allowlist and the store, unused by the screen.
Decisions made inside the plan's gaps (log, not yet confirmed):
- Save in this browser and Download are two buttons, not one.
- Using a saved recipe goes through the same path as loading a file, so the same warnings, the same previewable check and the same Preview rules apply.
Gap for the person to know: there is no screen for writing a recipe. A recipe is a JSON file (Appendix A) that someone writes elsewhere or is given; the app loads, keeps and reuses them. A form for building one is not in the plan.

### Independent static check of the Excel pack (2026-11-25, by an agent with no Excel)
Reported by the person. Part 1 is this repository's pack (13 cases); the report also covers a Part 2 (X01 to X03) that nothing in this repository or its branches produces.
- All 18 output fingerprints match the checklist. Every output passes package integrity (content types, relationships, well-formed XML, zip CRC) and opens in LibreOffice. Query text, metadata, permission bindings, VBA modules and cell values were read back and match what each case says. The no-bindings variant differs from `output.xlsx` only in the permission-bindings chunk. Nothing static contradicts any line that only Excel can confirm.
- Three things it noticed that are by design, now said in the checklist so nobody reads them as faults: a Transform output writes dates with its own fixed formats (`yyyy-mm-dd hh:mm:ss`), because its values come from the query result and not from the input sheet's cell formats (the old line, "look the same as in the input", was wrong); a combined sheet holds the computed value of a column that was a formula; a signed project loses its signature part when a module changes.
- Part 2's own findings (an arithmetic slip in the X03 checklist line: typing 4 beside 1 gives 5, not 6; Alt+F8 does not list event procedures, so X02's list is empty before and after) belong to whoever owns that pack. They are not fixed here.
- Still only Excel can say: no repair message, pane display, refresh, Compile, Alt+F8, signature dialog.
Changed expectations: the look lines of pack cases 11 and 13 (text only; no output file changed).

### F4-02 Recipe plus folder in one action (done, tests pass locally)
Layer: app, ui, tests
Files: src/app/intake.js, src/app/main.js, src/ui/strings.js, tests/unit/intake.test.js, tests/e2e/fable-recipe-drop.spec.js, tests/e2e/helpers.js
Do: `splitRecipe(snapshot)` takes top-level files named `*.quoin-recipe.json` (any case) out of a drop. One recipe with workbooks or a folder: the recipe loads, the files join the set (a set of one when it is a single workbook), and Preview starts when indexing has finished, the same Preview that the button gives. A recipe dropped alone loads when a set is open and is refused in words when none is. Two recipes are refused. A recipe inside a dropped folder is not taken as the recipe. A recipe that cannot be read opens the set and says why, with no Preview. A recipe the app cannot preview yet (in place, compute in Excel) is loaded and explained, with no Preview. A recipe dropped while a single workbook is open is refused ("Go back to the set before dropping a recipe.").
Test that fails without it: `tests/e2e/fable-recipe-drop.spec.js`, 9 tests, and 4 unit tests for `splitRecipe`. Making the auto-Preview do nothing failed 4 of the 9; starting it on any ready state, not only when indexing ends, failed the test that drops onto a set that is already ready.
Result: Done locally
Fails without: yes
Changed expectations: `dropTree` in `tests/e2e/helpers.js` now gives a top-level file its real bytes in the `files` list (it gave one byte). Browsers give the real file there, and the recipe is read from it.
Deviations: none.
Decisions made inside the plan's gaps (log, not yet confirmed):
- Only the exact suffix `.quoin-recipe.json` counts as a recipe in a drop. A plain `.json` file does not (the Load recipe picker still takes any `.json`).
- A recipe alone with no set open is refused, not held until files arrive.
- A load problem from a dropped recipe is kept and shown when the set screen appears, because the panel does not exist yet when the file is read.

### F4-04 Token editing (done, tests pass locally)
Layer: batch (pure), ui, app, tests
Files: src/batch/resolve/tokens.js, src/ui/set/recipe-panel.js, src/app/main.js, src/ui/strings.js, styles/set.css, tests/unit/batch-tokens.test.js, tests/e2e/fable-recipe-tokens.spec.js, tests/e2e/fable-visual.spec.js, tests/a11y/fable-shell.spec.js
Do: the Recipe panel has a Tokens list (a closed `details`, shown when a recipe is loaded) naming `{file.name}`, `{file.folder}`, `{unit.name}` and `{unit.index}` with what each gives, marking in words the ones the loaded recipe uses ("in use in this recipe") and offering Copy where the browser has a clipboard. `recipeTokens(recipe)` finds the known tokens used and the unknown ones in the query text and the output name, using the same rules as the resolver (so ordinary M braces are never flagged). An unknown token is noted when the recipe loads ("Unknown token {date}. Preview will not run this recipe.") and Preview refuses it with the first problem, the count of the rest and the list of valid tokens.
Test that fails without it: `tests/e2e/fable-recipe-tokens.spec.js`, 7 tests, 4 unit tests, an axe check in both themes with the list open and a token noted, and visual baselines for the panel with the list open and a saved recipe at three sizes. Removing the in-use marks, the load-time notes and the hint each failed tests.
Result: Done locally
Fails without: yes
Changed expectations: `tests/e2e/fable-preview.spec.js`, "a recipe the set cannot use shows the first problem in words": the refusal for an unknown token used to read `Unknown token {nope}.` and now reads `Unknown token {nope}. The tokens are {file.name}, {file.folder}, {unit.name}, {unit.index}.` The first sentence is the same string as before and as Appendix A. The test still checks the whole text, so it is stricter, not looser.
Deviations: "token editing" has nothing to edit in, because there is no recipe editor (see the gap noted under F4-01). Tokens are offered as a list with Copy, and flagged when a recipe uses a bad one.
Decisions made inside the plan's gaps (log, not yet confirmed):
- Copy rather than insert, for the reason above.
- The note at load time is in addition to the refusal at Preview, so the problem shows before the person presses Preview.

### F5-01 Firefox and WebKit (set up, first results pending)
Layer: tests, CI
Files: playwright.config.js, package.json, .github/workflows/browsers.yml
Do: `playwright.config.js` has `firefox` and `webkit` projects beside `chromium`, leaving out the visual specs (screenshots are made in Chromium) and the two Chromium-only specs (`fable-memory`, `fable-perf`, which use the DevTools protocol). `npm run test:browser` runs Chromium only, as before; `npm run test:browsers` runs the other two. A new workflow `browsers` runs both engines on every push to `fable` that touches source, styles or tests, and on request. It is not a gate yet: the browser downloads are blocked in the build sandbox, so CI is the only place these engines can run and the first run will say what fails.
Test that fails without it: the workflow itself, run by CI.
Result: Not yet run
Fails without: n/a
Changed expectations: none.
Deviations: none yet. Failures found will be fixed, or recorded here as Blocked with the engine and the reason.

### F5-02 Performance (done on one machine)
Layer: tests, app, docs
Files: tests/e2e/fable-perf.spec.js, .github/workflows/perf.yml, docs/fable/performance.md, src/ui/set/shell.js, tests/e2e/fable-scale.spec.js
Do: the numbers are in `docs/fable/performance.md`. Measuring found a real fault: indexing was quadratic because the Files list was rebuilt in full after every file (14.0 s for 500 files and 195.7 s for 2,000 on the build machine). The set shell now redraws progress at most five times a second and still redraws at once for a state change or an action by the person. Indexing 500 files takes 2.7 s and 2,000 files 17.3 s. Preview and Get are linear (75 to 96 files per second with one worker).
Test that fails without it: `fable-scale.spec.js` counts how often the list is rebuilt while 500 files index and allows one rebuild per 150 ms. With the old shell that test failed.
Result: Done
Fails without: yes
Changed expectations: none. The 500-file test also keeps its 60 s limit.
Deviations: Preview at 2,000 files stalls the page for 484 ms (about a quarter of a millisecond per file). It is linear, the cause is not found, and it is recorded as a known limit in `performance.md`. Nothing above 2,000 files was tried.

### F5-02b The pool budget counts inflated bytes (done)
Layer: core, batch, app, tests
Files: src/core/zip-read.js, src/core/workbook.js, src/batch/index/file-index.js, src/app/set-indexes.js, src/app/plan-run.js, src/app/collect-run.js, src/app/variant-text.js, tests/unit/batch-index.test.js, tests/unit/set-indexes.test.js, tests/unit/plan-run.test.js
Do: Q4 defines the in-flight budget in inflated bytes, but jobs were charged the size of the file on disk. A workbook of a few megabytes can inflate to 1 GiB within the limits, so a few of them at once could hold several gigabytes while the pool believed it held a few megabytes. The index now carries `inflated`, the uncompressed size the zip declares (0 for a file that was refused), and every job is charged `max(file size, inflated)`.
Test that fails without it: `plan-run.test.js` (each job is charged at the index's inflated size), `set-indexes.test.js` (3), `batch-index.test.js` (the index carries it).
Result: Done
Fails without: yes
Changed expectations: the list of keys of a file index in `batch-index.test.js` gains `inflated`, between `size` and `status`.
Deviations: none. The fixtures inflate to about their own size, so no browser test comes near the budget; the budget is exercised by the pool's own unit tests.

### F5-03 Memory (done)
Layer: tests
Files: tests/e2e/fable-memory.spec.js
Do: two tests. After a warm-up run, four more 50-file Previews and Gets leave the main-thread heap (JS heap plus array-buffer backing) within 10% of its baseline, and the pool reports nothing in flight, running, queued or leased, with every worker idle. A Preview alone keeps no output bytes. Retaining each downloaded zip made the first test fail; keeping bytes in the preview made the second fail. The first test passed six runs in a row.
Result: Done
Fails without: yes
Deviations: the baseline is taken after one warm-up run, not before the first run, because the first run loads and compiles the batch modules (about a quarter of a 3 MiB heap). A worker's own heap cannot be read from Playwright; the test checks the pool's accounting instead, and `performance.md` says so.

### F5-04 Pack and Excel results in the docs (done)
Layer: docs
Files: README.md, docs/observations.md
Do: the pack was already complete. The README no longer says nothing has been run in Excel, and `observations.md` records exactly what happened: the person's informal pass on 2026-11-24 (13 files open with no repair message, queries and macros ran without errors, contents not reviewed, checklist not ticked) and the static check on 2026-11-25. No line of the MX table was changed, because no check was ticked. In-place output and compute in Excel stay unbuilt.
Result: Done

### F4-05 Phase F4 gate
Checked 2026-11-26 against section 9 of the plan.
- [x] Lint 0 findings (T-LINT-1 included), 1,719 unit tests (5 skipped, as before), and the Chromium browser suite: 372 passed and 0 failed locally (visual specs run in CI, where their baselines are made). CI evidence is in the commit that follows this entry.
- [x] Every new test was shown to fail without its change: recipe drop (auto-Preview removed, trigger widened), tokens (marks, notes and hint removed), recipes (file-name fallback, focus move, skipped note), memory (retained bytes), scale (old shell).
- [x] No existing test weakened, skipped or deleted. Changed expectations are logged: the home footnote (F4-01 and F4-03), the unknown-token refusal text (F4-04), the `dropTree` helper (F4-02), and the file-index key list (F5-02b).
- [x] New surfaces (Save, Download, Saved recipes, Tokens list) have keyboard paths, axe checks in both themes, and visual baselines at three sizes in both themes. No new colour was introduced, so `pairs.json` is unchanged.
- [x] No new dependency, no network call. Storage: only `quoin.theme` and `quoin.recipes`, checked by a test that lists every key after use; the recipe is stored as text and no workbook, query or path is stored. The README says so, and says `quoin.recent` is allowed but not written.
- [x] The slice drop (recipe and folder together), Preview, Get works in Chromium by test (`fable-recipe-drop.spec.js`); nobody has tried it by hand.
- [x] README, `docs/decisions.md`, PROGRESS.md and MANAGER.md updated.
- [x] F4 gate: a recipe plus a folder reaches Preview in one action. The allowlist and the README agree.
Not part of the gate and still open: F4-01's hand-authoring gap (there is no recipe editor).

### Next
The F3 gate (F3-11) needs the person's decision on the three differences under F3-10. F4 is through its gate. F5 is waiting on the first Firefox and WebKit run in CI, the final gate, and the open decisions on section 9. Scope's in-place output (F3-08, `c15016d` on `fable-scope`) stays unmerged until a person has opened an in-place result in Excel; Excel-computes-on-open (F3-09) likewise.
