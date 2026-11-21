# quoin vNext — handover for a fresh chat

Read this first. It is short on purpose. Everything else is in the plan files listed at the end.

## Hard rules

1. Repo: `github.com/datakid/power-query-manager`. Work **only on the branch `beta`**. Do not read from, merge into, push to, or create any other branch. If the clone is not on `beta`, stop and fix that first.
2. No code comments, ever, in anything you write.
3. The owner supplies a GitHub token in chat when needed. Use it only as an HTTP header for `git` (`-c http.extraHeader="Authorization: Basic <base64 x-access-token:TOKEN>"`). Never write it into a file, a commit, a log or memory. Remind the owner to revoke it only when the whole plan is finished and confirmed.
4. Updates to the owner: one line per phase or milestone, in the style of a commit message, then carry on to the next item without asking. Do not write long reports mid-work. At the very end, one honest summary.
5. Stage explicit paths. The repo has no `.gitignore`: `git add -A` sweeps in `node_modules`, `dist` and `test-results`.
6. Never claim something is done that was not run. State what was not run.

## Sandbox facts

- No network access to Playwright's browser CDN. A Chromium exists at `/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`. Use a local config outside the repo (`/home/claude/pw.local.config.js`):

```js
import base from '/home/claude/quoin/playwright.config.js';
export default {
  ...base,
  testDir: '/home/claude/quoin/tests',
  snapshotPathTemplate: '/home/claude/quoin/tests/__visual__/{arg}{ext}',
  webServer: { command: 'node /home/claude/quoin/tests/e2e/server.js', cwd: '/home/claude/quoin', url: 'http://localhost:5173/index.html', reuseExistingServer: true, timeout: 20000 },
  projects: [{ name: 'chromium', use: { browserName: 'chromium', launchOptions: { executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox'] } } }]
};
```

- Run the browser suite detached and poll: `(setsid nohup npx playwright test -c /home/claude/pw.local.config.js --grep-invert "T-P-14b|T-E-12|T-I-04" > /home/claude/run.log 2>&1 &)`, then `sleep 270; grep -a -c '✓' /home/claude/run.log`. A single tool call dies after 300 s. A long detached run sometimes disappears; rerun it.
- `T-E-12` (keyboard loop) and `T-P-14b` (PDF export) cannot run here. Say so; do not claim them.
- Visual baselines: `npx playwright test -c /home/claude/pw.local.config.js tests/e2e/visual.spec.js --update-snapshots=all`. Plain `--update-snapshots` keeps images whose diff is under the 0.2 % tolerance and leaves stale pictures. Regenerate after any UI change and look at one image.
- `npm run build` must be run before committing UI or `src/` changes: `asset-manifest.json` has to list every shipped file (T-PRIV-1). Delete the `dist/` it creates.
- Fixtures: `npm run fixtures` regenerates `tests/fixtures/workbooks/*`; afterwards `git checkout` the files you did not mean to change (their bytes differ run to run).
- Local git identity: `datakid <datakid@users.noreply.github.com>`.

## Pitfalls already paid for

- Existing tests find the Run button by name `/^Run/` and the Download button by `aria-haspopup="dialog"`. Do not give new buttons those names or attributes.
- `getByRole('status')` must stay unique: use `aria-live` regions with their own class, not `role="status"`.
- Editor undo: change editor text with `Editor.replaceDiff` (it focuses the textarea first, so the native undo stack records it).
- The engine refuses to run any query while one query in the section does not parse. `many-queries.xlsx` has one on purpose; fix `Sales_Broken` before running.
- Code line height is 22 px (`--t-code-lh`); a fractional or 21 px value misaligns the editor overlay.
- The navigator list is virtualised: only about 30 rows of 320 are in the DOM. A test that wants a row far down must search for it (`getByRole('searchbox')`) or scroll `.rail` first; `[role=treeitem][data-name]` counts are a window, not the total (read `aria-setsize`).
- The selection bar buttons have accessible names starting with "Selection:" so that `/^Run/` still finds exactly one Run button.
- Do not persist anything in `localStorage` except the theme (T-LINT-8, G-3). Density is in memory.
- Style rules: `border-radius` and control heights must come from tokens (T-LINT-17); colours only in `tokens.css`; user-visible text only in `src/ui/strings.js` (T-LINT-9).
- When editing CSS with a script, match whole rules; a regexp on the first line of a multi-selector rule corrupts the next rule (happened twice).

## Where the work stands (branch `beta`)

Done and pushed, each with tests (details and deviations: `docs/next/PROGRESS.md`):

- Phase 2R: Glaze palette and the 02B visual refinement.
- WB-1 to WB-9: dependency index, step model, let-block edits, VBA outline, fuzzy matcher, M generation, engine batch evaluation, result store and worker protocol v2, run planner, status book, orchestrator, and its UI (Run all, Run stale, status dots, stored results).
- WB-13 palette and command registry. WB-14 Steps panel (partial). WB-17 dependency lists and graph. WB-18 Problems (dialog and counter). WB-19 sources inventory (no UI). WB-21 find and replace. WB-22 macro outline and per-procedure revert. WB-23 structure checks (no UI). WB-24 call graph (no UI). WB-25 macro to query links with "Run these queries". WB-26 step-level change summary. WB-27 budgets for what exists, with `many-queries.xlsx`.
- WB-11 the navigator: `src/core/wb/nav-model.js` (unit tests) and `src/ui/wb/navigator.js` (virtualised tree, search with `code:` and `step:`, Group by, Sort by, chips, multi-select, selection bar, row menu), wired from `Workspace.renderRail`, with `tests/e2e/navigator.spec.js`. Deviations and changed expectations are in `PROGRESS.md`.

Uncommitted at the time of this handover: the `S.nav` strings in `src/ui/strings.js` (prepared for the navigator) and the `UNSAFE` skip of `many-queries.xlsx` in `tests/unit/save-safety.test.js`. They are committed together with this file.

Last verified: lint 0 findings; unit 1047 pass; browser suite 188 pass, 0 fail (excluding `T-P-14b`, `T-E-12`, `T-I-04`); 40 visual baselines regenerated. Not run: `T-E-12`, `T-P-14b`, the manual browser matrix in `05_TEST_PLAN.md` §4.

## What is left, in the order to do it

1. **WB-12 tabs and split** (preview tab, pinned tabs, drag to split; `Alt+[` and `Alt+]`).
2. **WB-10 layout and mobile**: Run in the top bar as the one filled button with its menu (Run, to here, selected, downstream, stale, all), the Changes split button, the 390×844 bottom bar (Items, Code, Steps, Result, Problems counter), collapse shortcuts. Honour 02B tiers T1 to T4 and T-V-02/03/07.
3. **WB-16 result dock**: tabs Result, Pinned, Compare, Problems, Queue, Graph; pin and compare two results (the result store already supports pin and `rows` by `resultId`); the worker messages `view` and `profile`; Queue tab listing a batch with durations; Problems and Graph as tabs instead of dialogs.
4. **WB-14 remainder and WB-15**: drag grip, insert-step menu from the grid header (use `m-gen.js`), "Add as a step" from a view filter, step cursor with `F10`, Depends on and Used by already exist; step results refresh after a normal Run; narrow-screen presentation.
5. **WB-19 UI**: Sources list in the top bar menu, binding up front, and the check before Run all.
6. **WB-20 editor intelligence**: completion (library names from `lib-names.js`, steps, queries, VBA), signature help, go to definition and find references (`refs.js` for VBA, `deps.js` for queries), the "no callers" note. Show `structure.js` problems as gutter markers and in the Download tooltip.
7. **WB-27 remainder**: `vba-big.xlsm` cannot be generated; measure the VBA outline on synthetic text in a unit test instead and say so.
8. **WB-28 acceptance story** from `06_WORKBENCH.md`: write the e2e that follows it step by step on `many-queries.xlsx`, regenerate the visual baselines for Phase 6 (32 extra), complete `PROGRESS.md`, and fill the manual matrix in `docs/observations.md` with *not run* where it was not run.

Definition of done: every item above built, `npm test` green (excluding what cannot run here, stated plainly), baselines reviewed by eye, `PROGRESS.md` complete. Only then tell the owner it is finished and that they may revoke the token.

## Plan files (read in this order)

`00_START_HERE.md`, `02_IDENTITY.md`, `02A_IDENTITY_AMENDMENT.md`, `02B_VISUAL_REFINEMENT.md`, `03_EDIT_RUN_SAVE.md`, `04_PRINT.md`, `05_TEST_PLAN.md`, `06_WORKBENCH.md`; progress and deviations in `PROGRESS.md`. Where two disagree: later letter wins for shape and size (`02B` over `02A` over `02`); behaviour comes from `03`, `04`, `06`.
