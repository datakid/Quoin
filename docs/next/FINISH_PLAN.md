# quoin vNext: the plan to the end

One agent, one branch. Read this file first in a fresh chat. It replaces the "What is left" part of `HANDOVER.md`; the rules and the sandbox facts at the top of `HANDOVER.md` still hold and are repeated here where they matter.

The owner starts a fresh chat with the GitHub token and the line "continue the quoin plan on beta; read docs/next/FINISH_PLAN.md first". Nothing else is needed.

## Rules that cannot bend

1. Repo `github.com/datakid/power-query-manager`, branch `beta` only. Never read from, merge into, push to or create another remote branch. The branches `fable`, `fable-scope`, `fable-writer` and `main` are not part of this plan: do not touch them.
2. No code comments in anything written. Reasons go into `PROGRESS.md` and test titles (T-LINT-1 fails the build on a comment).
3. The token is used only as an HTTP header: `git -c http.extraHeader="Authorization: Basic $(printf 'x-access-token:%s' "$TOKEN" | base64 -w0)" push origin beta`. Never in a file, commit, log or memory. Remind the owner to revoke it only when everything below is done and confirmed.
4. Stage explicit paths (`git add asset-manifest.json src styles tests docs/next`). There is no `.gitignore`; `git add -A` sweeps in `node_modules`, `dist` and `test-results`. Delete `dist/` and `test-results/` before staging.
5. Never write that something is done that was not run. Say what was not run and why.
6. Updates to the owner: one line per milestone, then carry on. One honest summary at the very end.
7. Quality first: every item gets a unit test for its pure part, an e2e spec for its behaviour, lint, the manifest build, regenerated visual baselines if the UI changed (look at one image), a full browser run, and an entry in `PROGRESS.md` naming changed expectations, deviations and what was not done.

## Where things stand

- Branch `beta` is the project. It contains the whole of Phase 6 (the workbench): navigator, tabs and split, steps panel with step operations, dock (Result, Pinned, Compare, Find, Problems, References, Queue, Graph, Changes), column menu tools, sources, layout presets, completion and signature help, F12 and Shift+F12 and F2, VBA references and call graph, structure checks, the rebuilt top bar, the contract tests and the acceptance story.
- That work was written in two lines and then joined. The first line was mine (up to `95676d4`). The second was written by another agent from `95676d4` and handed over as a git bundle (`beta-v2`, 26 commits, tip `2b5678a`). It was reviewed, merged into `beta` and corrected (below). Its WB-20 replaced mine (mine is in history as `d564eed` and its revert); my VBA budget test was kept.
- Corrections made while merging: executable bits on 390 files removed (the base has none); the empty-state overflow menu added (Settings, Theme, Density, Shortcut sheet and About are reachable before a workbook is open); ten visual baselines regenerated for this environment; `tests/e2e/empty-menu.spec.js` added (4 tests).
- Known and recorded: visual state `06-result-differs` in the dark theme at 1280 wide fails about 3 times in 20 here even though the layout geometry is identical on every load (raster level, cause not found). All other visual states pass.

Verified in this environment before this file was written: lint 0 findings; unit 1162 pass and 5 skipped by design; browser suite on the merged tree 379 pass, with the only failures being the visual baselines that were then regenerated. The numbers are re-measured at the end (see "Final gate").

## Fresh chat: start here (about ten minutes)

1. Clone `beta` only: `git -c http.extraHeader=... clone --single-branch --branch beta https://github.com/datakid/power-query-manager.git quoin`; in it `git config user.name datakid`, `git config user.email datakid@users.noreply.github.com`, `npm install`, `git checkout package-lock.json`.
2. The Playwright config for this sandbox is in the repo: `scripts/pw.sandbox.config.mjs` (it finds the repo root itself and uses Chromium at `/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`; set `QUOIN_CHROMIUM` for another path). Use `-c scripts/pw.sandbox.config.mjs` wherever this file or `HANDOVER.md` says `-c /home/claude/pw.local.config.js`. Nothing has to be written outside the repo.
3. `npm run test:lint`, `npm run test:unit`, then one detached browser run: `(setsid nohup npx playwright test -c scripts/pw.sandbox.config.mjs > /home/claude/run.log 2>&1 &)` and poll with `grep -a -c '✓' /home/claude/run.log` every 4 minutes (a tool call dies after 300 s; a long detached run can vanish, start it again). Expect about 394 tests and about 12 minutes.
4. Read `PROGRESS.md` from the bottom up, then the plan file for the item you take (`06_WORKBENCH.md`, `02B_VISUAL_REFINEMENT.md`, `05_TEST_PLAN.md`).

## The work, in order

Each item has an acceptance line. Tick it in `PROGRESS.md`, not here.

### A. Land the merge (first, before anything else)

The merge was pushed to `beta` before this gate was finished, on purpose, so the work does not live in one sandbox only. Item 1 below is therefore a check on what is already on GitHub, not a condition for pushing it.

1. Run lint, unit, `npm run build`, one full browser run, the visual spec twice. Acceptance: everything green except the recorded flake.
2. Rewrite the stale part of `HANDOVER.md` (its "Where the work stands" and "What is left" describe the state before the merge) so it points here.
3. Add one section to `PROGRESS.md` for the merge (what came from the bundle, what was corrected, the flake).
4. Commit with explicit paths and push `beta`. Delete the local branch `beta-v2` (never push it). One line to the owner.

### B. Review the second agent's work properly

It was checked at the level of its tests, its log and its diffs of specs and config. It was not read line by line, and its WB-20 was not exercised with scenarios written by someone else. Do this before calling anything finished.

1. Port about ten scenarios from the reverted `d564eed` (`git show d564eed:tests/e2e/intel.spec.js`) to the new completion UI as `tests/e2e/completion-cross.spec.js`: prefix opens and Tab inserts, Escape closes, steps only before the caret, quoted insertion, columns after a run and after an edit, signature with optional parameters, F12 on step, query and function, Ctrl+click, exact reference counts skipping strings and comments, F2 on a query name. Any scenario that fails is either a bug (fix it with a test) or a different, defensible behaviour (record it in `PROGRESS.md`).
2. Read in full: `src/core/wb/completion.js`, `m-refs.js`, `src/ui/wb/autocomplete.js`, `signature.js`, the step preview path (`stepEdit`, `previewSteps`), `Workbench` methods added by the v2 sessions, and `src/core/pq/section.js` (the CRLF change). Look for: dead code, an exported function nothing calls, state that survives an item switch, a listener that is never removed, an unbounded loop on half-typed text.
3. Find unreferenced modules: every file under `src/` must be imported or listed in the manifest for a reason. Remove what is dead, with a test run proving nothing changed.
4. Re-check the privacy and safety tests (T-PRIV, T-LINT-8: nothing but the theme in `localStorage`), the CSP in `_headers` and `vercel.json`, and that `asset-manifest.json` lists every shipped file.
5. Time-box one hour to the visual flake of `06-result-differs` (dark, 1280): find what differs per load (compositing and text anti-aliasing are the suspects). Either fix the cause with a test, or document what was tried.

### C. Deviations from the plan that are still open

Decide each one deliberately, build it if the plan says so, and record the outcome.

1. **View sort in the column header menu.** The plan runs sort, filter and hide as view-only operations in the worker (`view` message). Filter and hide do; the menu's Sort entries are still the grid's display sort. Build it: Sort ascending and descending for a stored table result call the worker `view` with `sort`, the chip says `sorted by Age ↑`, Clear view restores, the 200 000 row limit and its reason stay for results above it (T-B-11). `src/core/wb/view-ops.js` already sorts and is unit tested against `Table.Sort`. Acceptance: the unit tests stay, a new e2e proves the order and the chip, T-B-11 still passes.
2. **Download tooltip and Changes review list the structure checks of macro modules**: done by the second agent; confirm with the scenario in `structure.spec.js` and note it.
3. **Bypassed-step count on a navigator row**: recorded as deviated (needs the steps model of every query on every refresh). Decide: build it lazily for rows in the virtual window only, or keep the deviation with the reason in `decisions.md`.
4. **Locked VBA project e2e**: no fixture can be produced here. Keep the unit coverage and say so.
5. **`vba-big.xlsm`**: cannot be generated. The VBA budgets are measured on synthetic text (`tests/unit/wb-vba-budget.test.js`).

### D. What cannot run here (state it plainly in the last summary)

`T-P-14b` (PDF export through the browser's print path), the manual browser matrix in `05_TEST_PLAN.md` section 4 (Firefox, Safari, real touch devices) and anything needing a real macOS or Windows file chooser. `observations.md` lists them as not run. Do not tick them.

### E. Final gate

1. `npm run test:lint`, `npm run test:unit`, `npm run build`, a full browser run (all tests, nothing excluded except what D lists), the visual spec twice.
2. Look at three visual baselines by eye (desktop light, desktop dark, 390 wide).
3. `PROGRESS.md` is complete: every item above has an entry, with changed expectations, deviations and what was not done.
4. `README.md` and `docs/decisions.md` match what shipped.
5. Commit with explicit paths, push `beta`, confirm `git status -sb` shows `beta...origin/beta` with nothing ahead.
6. Only now tell the owner the plan is finished, give the honest summary (what is built, what was measured, what could not run), and say they may revoke the token.

## Pitfalls already paid for

The list in `HANDOVER.md` ("Pitfalls already paid for") stays valid. Added since:

- The top bar now has the palette field, the Changes button with its split menu, Print, the Run split and the overflow. Specs reach Settings, Download and Export through the helpers `openSettings`, `openDownload` and `openExport` in `tests/e2e/helpers.js`. Do not click the old buttons; they are gone.
- Tests that open Settings with no workbook can use the overflow menu now (`More actions`); the empty-state menu has six entries and the full one more than eight.
- `src/app/workspace.js` is now `src/app/workbench.js` and the class is `Workbench`.
- A file chooser opened by a key press is lost about one time in three if the waiter and the key press share a tick: register `page.waitForEvent('filechooser')`, await one round trip, then press.
- A failure that shows only in a full run should be reproduced alone before it is called a timing problem; most were not.
- The visual baselines are sensitive to the machine's font rasterisation: a baseline made elsewhere can differ by 2 percent over the whole page with nothing moved (diff images show only glyph edges). Regenerate here with `--update-snapshots=changed`, then run the visual spec twice before accepting.
- A merge from outside can bring file mode changes: check `git diff --summary <base> HEAD | grep "mode change"` and restore modes (the base has no executable files).

## Everything the work needs is in this branch

- The plan files, the progress record and this plan: `docs/next/` (all 23 files of the original handover zip are here; `PROGRESS.md` and `HANDOVER.md` are the only ones edited since).
- The Playwright config for this sandbox: `scripts/pw.sandbox.config.mjs`.
- The second agent's work: merged into `beta` (merge commit `40b6381`), so its 26 commits are in the history. The bundle file itself is not stored (26 MB, and everything in it is already here). Its own record of a full run, from its environment, is kept as `docs/next/evidence/second-agent-browser-suite-wb28-closeout.log`; it was not trusted as proof, the suite was re-run on the merged tree here.
- My own earlier WB-20 work, superseded: commit `d564eed` (and its revert) in the history.
- The fixtures (`tests/fixtures/`), the visual baselines (`tests/__visual__/`) and the generators.
- The owner's token is not in the repo and never will be.
