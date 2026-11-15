# Fable progress

## Phase F0 — Set

### Baseline (beta at 9afea2a, recorded in F0-01)

- Lint: 0 findings.
- Unit: 928 tests, 923 pass, 0 fail, 5 skipped locally; CI shows 922 pass, 6 skipped. One CI unit step failed once with no cause found and passed on every other run.
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
Result: Done locally; browser results from CI are recorded below once the run finishes.
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

### Blocked
- `quoin-fable.md` (the decision document) has not been supplied, so `docs/fable/00_FABLE.md` cannot be written and tasks citing Fable §3.3, §6.1, §9, §12 and §15 cannot start (F0-12, F3-02, F3-10).
- Six browser tests fail on beta and need an owner. They sit in beta's Phase 6 area, so the decision is whether beta's other agent fixes them and Fable takes the fix by merge, or Fable fixes them here. Editing any of these tests needs the user's approval (§11.3).
  - `keyboard.spec.js:57`: the shortcut sheet is generated from the command registry and lists "Alt+Up" and "Alt+Down" as two rows; the test expects one row "Alt+Up / Alt+Down". Reproduced locally. Stale test expectation.
  - `steps-panel.spec.js:78`: after "Move and rewire", "Added Custom" is still after "Changed Type" in the editor text. Reproduced locally and on CI.
  - `store.spec.js:60`: cancelling a batch with an endless query returns `ok` instead of `cancelled`. Reproduced locally and on CI.
  - `palette.spec.js:46` and `:69`, `keyboard.spec.js:9`: fail on CI only or intermittently; `palette.spec.js:46` and `keyboard.spec.js:9` pass locally. Not reproduced.

### Deviations
- See F0-00.
