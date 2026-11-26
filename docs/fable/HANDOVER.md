# Handover: Quoin "Fable" (branch `fable`)

Read this first, then `docs/fable/MANAGER.md`, `docs/fable/PROGRESS.md` and `docs/fable/01_PLAN.md`. The user resumes with the single word `continue quoin`. Do not ask the user anything that is in this file.

## Rules that stay in force

- Work only on branch `fable`. Do not create branches. Do not touch `beta`.
- No code comments in repo code (lint T-LINT-1).
- Commit messages are short, git style. End each with:
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_017acr3aWA4cSE8LoELJxEcQ`
- Never store the GitHub PAT. The user was told to revoke it.
- Before every push: `node tests/lint/run.js` and `node --test tests/unit/*.test.js`. After any `src/` change: `node scripts/build-manifest.mjs`.
- Pull with rebase before pushing. CI can add an "Update visual baselines from CI" commit.

## Remote

- The live repo is `https://github.com/datakid/Quoin` (GitHub redirected from `datakid/power-query-manager` on 26 Nov 2026). The local remote is set to it.
- `gh run list -R …` fails in this sandbox. Use `gh api "repos/<owner>/<repo>/actions/runs?branch=fable&per_page=N"`, then `.../runs/<id>/jobs`, `.../check-runs/<jobid>/annotations`, and `gh run view <id> -R <owner>/<repo> --log-failed` once a run has finished.

## Where things stand

- Latest pushed commit on `fable`: `79c3b8c` (quadratic indexing fixed, pool charged at inflated size, memory/perf/cross-browser work). CI and openxml were green on it.
- F0 to F3 are done or released as far as the plan allows. F4 is done through its gate.
- F3-08 (in-place output, Scope commit `c15016d`) must NOT be merged. F3-09 (Excel computes on open) stays held. Both wait for real-Excel results.
- The user's informal real-Excel pass of the pack opened without repair messages. Contents were not reviewed, and the checklist is not ticked. That counts as the gate for F3-06 and F3-07 only.
- F5-01 (cross-browser) is in progress. This is the main open work.

### F5-01 cross-browser triage (first `browsers` run, id 45760582496, commit 79c3b8c)

WebKit: 14 failed of 383. Firefox: 15 failed of 368. Firefox and WebKit cannot be downloaded in the sandbox (the browser CDN is blocked by the proxy). Only CI can reproduce them. Chromium runs locally.

Classified as REAL, fix in progress (uncommitted, see below):
- Multi-file drop never reaches `ready` (`drop.spec.js` T-B-16, `fable-intake.spec.js:50`, `fable-shell.spec.js:138`). Cause: `dataTransfer.items` entries are used even when the drop is only files. Fixed in `src/app/intake.js`: entries are used only when a folder is in the drop.
- Worker output hash differs per engine (`fable-apply-worker`, `fable-collect-worker`). Compressed bytes differ by deflate implementation. Fixed in tests only: non-Chromium engines now compare unzipped entry hashes, and Chromium keeps the exact check.

Still REAL and NOT fixed:
- `fable-matrix.spec.js:80` (WebKit) and `:96,124` (Firefox): 5000 rows are all painted; virtualisation is not applied in the engine. Look at `src/ui/grid.js` `paint()` (rows between `first` and `last` based on `scrollTop` and `clientHeight`) and at the scroll container CSS in `styles/grid.css` and `styles/set.css` (`.set-result[data-matrix] > .grid`). Probably the grid's `clientHeight` is 0 or huge in those engines under the test viewport. Investigate before changing.
- `fable-row-diff.spec.js:111` (WebKit, phone layout): bottom 1484 vs shell 797. Layout issue at phone width.
- `grid.spec.js:46` (Firefox), `refinement.spec.js:60`, `safety.spec.js:13`, `perf.spec.js:39`, `fable-recipe-tokens.spec.js:62`: not yet read in detail. Read them from the CI log before classifying.

Classified as ENGINE or TEST LIMITS, to skip by `browserName` with a recorded reason, logged as Blocked in PROGRESS:
- `print.spec.js:86,103` (PDF generation, Chromium-only API).
- `fable-recipe-tokens.spec.js:62` (`grantPermissions` "clipboard-write" unknown outside Chromium).
- `privacy.spec.js:127,151` (offline start). Probably a Playwright or engine limit; confirm from the log.

Triage detail: `$S/b2.log` and `$S/browsers.log` in the scratchpad may be gone. Re-fetch with `gh run view 45760582496 -R <repo> --log-failed`.

### Uncommitted working-tree changes (saved as a patch)

Saved to `docs/fable/handover/wip-2026-11-26.patch` (apply with `git apply`). Not yet run on CI.

- `src/app/intake.js`: `dropEntries` uses directory entries only when the drop has a folder.
- `tests/unit/intake.test.js`: three new tests for that rule. 23 pass.
- `tests/e2e/helpers.js`: `waitForSet` gives state and page problems on timeout; `expectSameOutput` and `zipDigest`; files get `lastModified` so repeat drops are recognised.
- `tests/e2e/fable-apply-worker.spec.js`, `fable-collect-worker.spec.js`: use `expectSameOutput`.
- `tests/e2e/fable-intake.spec.js`: the repeat-file test drops the same `lastModified`. Passes on Chromium (6/6).
- `.github/workflows/perf.yml`: push trigger with a `[perf]` commit-message check. Needed to collect four-core CI numbers for `docs/fable/performance.md`.

Local Chromium result for the changed specs: `apply-worker`, `collect-worker`, `intake`, `drop` all pass (20 + 6 tests).

## Open decisions for the user (do not decide these yourself)

Section 9 differences in `PROGRESS.md`:
1. Rows with a missing column read `failed`, not "skipped".
2. The report has 15 lines, not 13, because the two `.xls` files each add a refused row.
3. No inject-only fallback in new-sheet Transform.

Readings of "approved" that the user should confirm:
- Signed VBA confirmed once per set.
- Remove or rename of Excel-made queries is refused until real-Excel results exist.
- Q5: reuse an existing load target only.

## Known gaps and risks to report, not hide

- Real Excel has not verified output contents, `.xlsm` new-sheet copies, in-place writes, or compute-in-Excel.
- No recipe editing UI. Recipes are JSON files.
- Transform Preview does not show the produced table.
- Preview stalls the page for 484 ms at 2000 files (cause unknown).
- Module align refuses non-ASCII modules.
- `T-WB-05` and `T-WB-09` are flaky. Do not chase them.
- Part 2 (X01–X03) of the user's external test report is not from this repo. Its owner handles it.
- The Writer (`fable-writer`) and Scope (`fable-scope`) agents have been silent since 21 Nov. Nothing from them can be assumed.

## Why the last session went badly, and the split for the next one

The user's criticism is fair. The sub-agents did not split work well, and the integrator (me) ended up doing nearly all the trunk work alone. The next session should:

1. Work in lanes with one owner per file. A file is edited by one lane at a time.
   - Lane A, cross-browser (F5-01): owns `tests/e2e/**`, `playwright.config.js`, `.github/workflows/browsers.yml`, and the grid fixes in `src/ui/grid.js`, `styles/grid.css`.
   - Lane B, drop and intake: owns `src/app/intake.js`, `src/app/set-*.js`, `tests/unit/intake.test.js`.
   - Lane C, real-Excel and outputs (held items only): owns `src/batch/**` output code and `scripts/make-excel-pack.mjs`. No merges of F3-08 or F3-09 without user approval.
   - Lane D, docs: only the integrator edits `PROGRESS.md`, `MANAGER.md`, `README.md`, `docs/observations.md`. Lanes send their summary to the integrator and do not edit those files.
   - Shared files (`src/app/main.js`, `src/ui/strings.js`, `styles/set.css`) go through the integrator, one at a time.
2. Each lane gets a brief with: the goal, the files it owns, the test command, what is already ruled out, and the exact done condition. The lane returns a short commit summary, not a narrative.
3. Each lane runs lint and the unit tests, plus its own specs on Chromium, before it hands back. CI on Firefox and WebKit is the only check for those engines.
4. Speed: lanes run in parallel only where their files do not overlap. Long Playwright runs go in the background with `nohup`, then get polled. The Bash default timeout is 2 minutes, and `pkill -f "playwright test"` in the same command kills the shell.
5. Local Playwright: `npx playwright test -c $S/pw.local.config.mjs --project=chromium <specs>`, with `S` set to the session scratchpad. Use `--project=chromium` because the config also has Firefox and WebKit projects.

## Patches and files that matter

- `docs/fable/00_FABLE.md`, `docs/fable/01_PLAN.md`: the spec and phases F0 to F5.
- `docs/fable/MANAGER.md`: integrator notes and status.
- `docs/fable/PROGRESS.md`: per-task status, Blocked entries, section 9 differences.
- `docs/fable/performance.md`: perf numbers, waiting for CI four-core run.
- `docs/fable/handover/wip-2026-11-26.patch`: the uncommitted fixes listed above.

## First steps for the next session

1. `git status`, `git log -1`, confirm branch `fable` and the remote.
2. Apply the patch if it is not in the tree: `git apply docs/fable/handover/wip-2026-11-26.patch`.
3. Run lint, unit tests, and the four Chromium specs listed above.
4. Fetch the `browsers` run details for the failures still unclassified (`grid.spec`, `refinement`, `safety`, `perf`, `fable-recipe-tokens`, `row-diff`).
5. Fix the matrix virtualisation and the phone row-diff layout. Skip the engine-limit tests by `browserName` with a recorded reason.
6. Commit, push, and check the next `browsers` run.
7. Only then, ask the user about the section 9 decisions and the Excel holds.
