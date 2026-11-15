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
Result: Partly done. `01_PLAN.md` is a verbatim copy of the plan. `00_FABLE.md` is Blocked.

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
Blocked within this task: new visual baselines (plan §7.6). Local Chromium renders differently from the CI runner, so a baseline made here would fail on CI, and the 36 existing baselines already fail there. Needs your decision on how baselines are generated (see Blocked).
Decisions made inside the plan's gaps (log, not yet confirmed by the user):
- The start screen and its tests are unchanged; the shell replaces it only once a set exists, and returns to the shell's own empty state if every file is removed.
- Two new strings in the error table (`file.unsupportedExtension`, `file.lockFile`) and one for `pq.none`.
- At narrow widths the existing top bar hides the summary text; the run bar still shows the counts.
- Rows are not virtualised; the list renders every file. F0-13 measures this with 500 files.
Counts after this task: lint 0 findings; unit 1052 tests.

### F0-12 Single file inside a set
Result: Not started on purpose. Its test covers every row of Fable section 6.1, which is not available (see Blocked). Mounting today's workspace from the set touches the single-file flows, so it waits for that test.

### F0-13 Responsiveness
Layer: test only
Files: tests/e2e/fable-responsive.spec.js
Do: drop a folder of 200 generated workbooks and measure main-thread long tasks from the moment of the drop; check that indexing finishes within 60 s with every file ready; type into the filter and check that each change takes under 100 ms and no long task is over 100 ms.
Test that fails without it: not applicable, this is a test-only task. The long-task observer was checked on the page: it reports a 155 ms task during application start-up, which is why the measurement counts only tasks that start after the drop or after typing begins.
Result: Done locally (both tests pass in about 6 s each); CI result is recorded when the run finishes.
Fails without: not applicable
Changed expectations: none
Deviations: none
Note: the application's own start-up has one long task of about 155 ms in local Chromium. It is outside this acceptance criterion and unchanged from beta.

### Blocked
- `quoin-fable.md` (the decision document) has not been supplied, so `docs/fable/00_FABLE.md` cannot be written and tasks citing Fable §3.3, §6.1, §9, §12 and §15 cannot start (F0-12, F3-02, F3-10).
- New visual baselines for the Fable shell and the existing 36 failing baselines: need a decision. Options are to generate Linux baselines on CI and review each image before accepting them, or to run visual tests only on the machine that made the baselines.
- Six browser tests fail on beta and need an owner. They sit in beta's Phase 6 area, so the decision is whether beta's other agent fixes them and Fable takes the fix by merge, or Fable fixes them here. Editing any of these tests needs the user's approval (§11.3).
  - `keyboard.spec.js:57`: the shortcut sheet is generated from the command registry and lists "Alt+Up" and "Alt+Down" as two rows; the test expects one row "Alt+Up / Alt+Down". Reproduced locally. Stale test expectation.
  - `steps-panel.spec.js:78`: after "Move and rewire", "Added Custom" is still after "Changed Type" in the editor text. Reproduced locally and on CI.
  - `store.spec.js:60`: cancelling a batch with an endless query returns `ok` instead of `cancelled`. Reproduced locally and on CI.
  - `wb-fuzzy.test.js:73` (T-WB-05, under 30 ms for ten thousand items): a timing threshold that fails on slow runners; needs the same owner decision.
  - `palette.spec.js:46` and `:69`, `keyboard.spec.js:9`: fail on CI only or intermittently; `palette.spec.js:46` and `keyboard.spec.js:9` pass locally. Not reproduced.

### Deviations
- See F0-00.
