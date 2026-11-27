# Notes: harness lane

Written by the harness lane only. The integrator reads this and moves what matters into PROGRESS.md and MANAGER.md.

Brief: docs/fable/lanes/harness.md

Run in a separate session from the integrator's clones, with Chromium 141 from the npm package `@sparticuz/chromium` (kept outside the repo, because the Playwright download is blocked there). Work was pushed to `fable-trunk-handover` and checked on Firefox and WebKit with `workflow_dispatch` runs, not by a push to `fable`.

## Changes

| Item | Test | Engine | Decision | Commit | Reason | Verified |
|---|---|---|---|---|---|---|
| 1 | fable-apply-worker.spec.js:58, :71, :92 and every other `expectSameOutput` | Firefox, WebKit | fixed | 3fb4e98 | The inner Power Query package in `customXml/item1.xml` holds a rewritten `Section1.m`, which each engine deflates in its own way, so the outer text differed while the content was the same. `zipDigest` now unpacks the package and hashes its entries, permissions, metadata and bindings, plus the XML text around the base64 body. Chromium keeps the exact byte check. | Chromium local. A scratch run with a different deflate (outside the repo) differed from Node only in `customXml/item1.xml` under the old digest, was equal under the new one, and a different recipe text still differed. CI run 45952953452 (a70284d): passes on Firefox and WebKit |
| 2 | fable-recipe-tokens.spec.js:62 | Firefox, WebKit | fixed | b0257dc | `grantPermissions` and `clipboard.readText` are Chromium only. Chromium keeps the real clipboard read-back. The other engines stub `navigator.clipboard.writeText` in the page and check the token passed and the Copied status. The real clipboard write is not exercised there. | Chromium local, and the stub path on Chromium with a throwaway copy of the spec. CI run 45952953452: passes on Firefox and WebKit |
| 3 | print.spec.js:86, :103 | Firefox, WebKit | skipped | c8af1fd, a12bffe | `page.pdf` is only supported by headless Chromium in Playwright | Chromium local. CI: skipped on both engines |
| 4 | refinement.spec.js:60 | Firefox | skipped | c8af1fd, a12bffe | Playwright does not support the `isMobile` context option in Firefox. The skip is Firefox only, so WebKit keeps running it. | Chromium local. CI: skipped on Firefox, passes on WebKit |
| 5 | privacy.spec.js:127, :151 | WebKit | skipped | c8af1fd, a12bffe | Playwright WebKit fails `page.reload` and `page.goto` after `setOffline(true)` with an internal error. The cause is taken from the CI error text; I could not reproduce WebKit here. | Chromium local. CI: skipped on WebKit, passes on Firefox |
| 6 | safety.spec.js:13 | Firefox | fixed (test limit, not an app finding) | eb4798a | The leave guard is installed and the page has user activation (probe on Firefox), but Playwright's `page.reload()` never surfaces the `beforeunload` prompt there. A reload started from inside the page does, on Firefox and WebKit. The test now reloads from the page and still expects a `beforeunload` dialog. The key press from the first attempt (7bdec5d) stays. | Chromium local, twice. CI run 45954575509 (eb4798a), `safety.spec.js` alone: 2 passed on Firefox and 2 on WebKit |
| 7 | browsers.yml summary | both | done | da1d92b | A table of failed tests (file, line, title, first error line) is written to the job summary. The run also writes a JSON and an HTML report and keeps traces for failures, and the failure artifact carries them. Triggers and matrix are unchanged. | YAML parses and the shell extracts and passes `bash -n`. The summary script ran on Chromium against a real report with a failing test. It has not yet run in Actions, so the job summary page is unchecked |
| 8 | flake audit | Chromium | done, no change | none | See the audit below | Chromium local |
| 9 | uniform skip form | all | done | a12bffe | `skipUnlessChromium(test, browserName, reason)` and `skipOnEngines(test, browserName, engines, reason)` in `helpers.js`, additive. Print uses the first, refinement and privacy the second, so the Firefox-only and WebKit-only skips keep the other engines. | Both helpers skip and run in the right cases (throwaway spec) |
| extra | browsers.yml `spec` input | both | added | d02d529 | `workflow_dispatch` takes an optional spec path appended to the Playwright command through an environment variable. No input means the whole suite. | Used for the probe and the safety run |

## Flake audit (item 8)

- Five runs in a row of all seven specs on Chromium: 210 of 210 passed (42 tests, 5 times).
- No fixed sleep was replaced. The 20 ms loops in the apply and collect worker specs poll for the worker's reply and are condition waits. `privacy.spec.js:109` uses 500 ms as the bound for "no policy violation", inside a promise that resolves on the event.
- `print.spec.js:261` keeps `waitForTimeout(500)`. It guards a negative check (no console message, no policy violation) after the preview re-renders on a 60 ms debounce, and the live region resets inside the render, so there is no observable that marks the last render finished.

## Every skip in tests/e2e/ (item 10)

| Where | Condition | Reason |
|---|---|---|
| fable-perf.spec.js:7 | all engines unless `QUOIN_PERF` is set | measurement, run with QUOIN_PERF=1 |
| print.spec.js:87, :105 | not Chromium | `page.pdf` is only supported by headless Chromium |
| refinement.spec.js:61 | Firefox | `isMobile` context option unsupported in Firefox |
| privacy.spec.js:128, :153 | WebKit | internal error after `setOffline(true)` |
| playwright.config.js:16, :17 | Firefox and WebKit, `testIgnore` | `*visual.spec.js`, `fable-memory.spec.js`, `fable-perf.spec.js` are Chromium only |

No `test.fixme` exists in `tests/e2e/` or `tests/a11y/`. Offline start in real Safari is not verified by any test.

## Open

- Whole-suite CI run 45952953452 (a70284d, before the item 6 fix): WebKit 2 failed, 4 skipped, 382 passed. Firefox 5 failed, 3 skipped, 380 passed. The one harness failure left, `safety.spec.js:13` on Firefox, is fixed in eb4798a and passes alone. A whole-suite run on the final commit has not been done.
- The failures left are all in specs the ui lane owns, none in this lane:
  - WebKit `fable-matrix.spec.js:80`: five thousand rows paint 5000 `.grid-row` elements, expected fewer than 80. Looks like an app finding in the matrix virtualization on WebKit.
  - WebKit `fable-row-diff.spec.js:111`: on a phone viewport a pane bottom is 1484.8, expected at most 797.
  - Firefox `fable-matrix.spec.js:96` (`not.toBeFocused` failed after Tab) and `:124` (drag selection, deep equality).
  - Firefox `grid.spec.js:46` (selection and copy event text) and `perf.spec.js:39` (T-PERF-3, 1,000,000 rows). I did not see the full error for these two.
- The artifact host (`productionresultssa2.blob.core.windows.net`) is blocked from this environment, so full CI logs and the failure artifacts could not be read. Only check-run annotations were readable, and those keep the first few failures.
- Commit trailers carry `Co-Authored-By` only. The `Claude-Session` line names the integrator's session, so I did not copy it.

## Needed from another owner

- ui lane or integrator: the six failures above.
- integrator: fold this file into PROGRESS.md and merge `fable-trunk-handover` (`eb4798a` plus the notes commit) into `fable`. I did not push to `fable` after the lane rules changed.

HAND BACK eb4798a
