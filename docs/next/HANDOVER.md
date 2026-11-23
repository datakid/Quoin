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
- Each editor group owns an `Editor`; `ws.editor` is the active group's. Tests that fill a textarea while two groups are open must scope it (`.editor-group` nth). Page-wide drag handlers only act on file drags.
- The selection bar buttons have accessible names starting with "Selection:" so that `/^Run/` still finds exactly one Run button.
- Two perf unit tests (`T-WB-01` 300 ms index, `T-WB-05` 30 ms ranking) fail when a browser run is using the machine. Rerun them alone before believing a unit failure.
- `pkill -f "tests/e2e/server.js"` matches your own shell and kills it; use `pkill -f "[t]ests/e2e/server.js"`. A stale dev server from an earlier run is reused (`reuseExistingServer`) and can make a comparison against another checkout meaningless; kill it first.
- The editor tabs (`.tabstrip`) and the dock tabs (`.dock-tabs`) are both `role="tab"`. Scope tab locators to one of them.
- Native drag and drop in Chromium: cancel `dragenter` as well as `dragover` on a drop target, never change the layout during `dragover` (the pointer lands on the thing you inserted and the drag flickers), and the app's page-wide drag handlers must ignore non-file drags (they once forced `dropEffect = copy`, which silently blocked every other drop). Playwright's `dragTo` works for visible targets; for a target that only appears during the drag use `page.mouse` with steps.
- `F10` and `Shift+F10` only act when focus is in the editor or the steps panel: `Shift+F10` is the context menu key and several menus here rely on it.
- At 390 px the Items button in the bottom bar carries the class `rail-toggle` (tests and `states.js` use it); the head's old button is `rail-toggle-wide`, shown only from 640 to 1023 px.
- Commands receive the keyboard event as a second argument (`cmd.run(ctx, ev)`); the command stubs in `tests/unit/wb-commands.test.js` list the workspace methods the registry calls and need a new line whenever a command calls a new one.
- `npm install` rewrites `package-lock.json`; `git checkout package-lock.json` before committing.
- Do not persist anything in `localStorage` except the theme (T-LINT-8, G-3). Density is in memory.
- Style rules: `border-radius` and control heights must come from tokens (T-LINT-17); colours only in `tokens.css`; user-visible text only in `src/ui/strings.js` (T-LINT-9).
- When editing CSS with a script, match whole rules; a regexp on the first line of a multi-selector rule corrupts the next rule (happened twice).

## Where the work stands (branch `beta`)

Done and pushed, each with tests (details and deviations: `docs/next/PROGRESS.md`):

- Phase 2R: Glaze palette and the 02B visual refinement.
- WB-1 to WB-9: dependency index, step model, let-block edits, VBA outline, fuzzy matcher, M generation, engine batch evaluation, result store and worker protocol v2, run planner, status book, orchestrator, and its UI (Run all, Run stale, status dots, stored results).
- WB-13 palette and command registry. WB-14 Steps panel (partial). WB-17 dependency lists and graph. WB-18 Problems (dialog and counter). WB-19 sources inventory (no UI). WB-21 find and replace. WB-22 macro outline and per-procedure revert. WB-23 structure checks (no UI). WB-24 call graph (no UI). WB-25 macro to query links with "Run these queries". WB-26 step-level change summary. WB-27 budgets for what exists, with `many-queries.xlsx`.
- WB-14/15 (part): F10 step cursor, drag reorder, Insert step after and the narrow Steps sheet in `steps-panel.js` and `Workspace`, `tests/e2e/step-ops.spec.js`.
- WB-16 (first slice): `src/ui/wb/dock.js`, `dock-views.js`, `problems-view.js`, `graph-view.js` (`mountGraph`), `src/core/wb/compare-results.js`, pin and tab handling in `Workspace`, `tests/e2e/dock.spec.js`.
- WB-16 (second slice, the column header menu): `src/core/wb/profile.js`, `src/core/wb/view-ops.js`, `view` and `profile` worker messages, `src/ui/wb/column-tools.js` (filter dialog, Add as a step dialog, profile sheet), `grid.columnTools`, view state in `Workspace`, `tests/e2e/column-tools.spec.js`.
- WB-10 (part): `src/ui/wb/panes.js`, collapse rails, inspector resizer, F6, the 390 px bottom bar and Steps sheet, the run menu, `tests/e2e/layout.spec.js`.
- WB-12 tabs and split: `src/core/wb/tabs-model.js` (unit tests), `src/ui/wb/tabs.js`, tab and group handling in `Workspace` (`select`, `present`, `applyTabState`, `addGroup`), the five tab commands, `tests/e2e/tabs.spec.js`.
- WB-11 the navigator: `src/core/wb/nav-model.js` (unit tests) and `src/ui/wb/navigator.js` (virtualised tree, search with `code:` and `step:`, Group by, Sort by, chips, multi-select, selection bar, row menu), wired from `Workspace.renderRail`, with `tests/e2e/navigator.spec.js`. Deviations and changed expectations are in `PROGRESS.md`.

Commits on `beta` from this series (newest first): `94e52b1` WB-14/15 part, `d6bace6` WB-16 first slice, `8d96afd` WB-10 part, `1772374` WB-12, `424b9de` WB-11. Nothing is uncommitted.

Last verified: lint 0 findings; unit 1105 pass (5 skipped by design); browser suite 248 pass, 0 fail on the code as committed (excluding `T-P-14b`, `T-E-12`, `T-I-04`), then the spec for the column tools run again alone after its last edit (12 pass, one test swapped); visual baselines regenerated after each UI change and looked at. Not run: `T-E-12`, `T-P-14b`, the manual browser matrix in `05_TEST_PLAN.md` §4.

## What is left, in the order to do it

1. **WB-10 remainder**: Run as the one filled button in the top bar, the Changes split button, layout presets (Write, Debug, Review), the top bar overflow menu. Collapse, resize, F6 and the mobile bottom bar are done (see `PROGRESS.md`).
2. **WB-16 remainder**: the result header line and Excel verdict chip, Export per result id, side by side compare, the Changes tab, a view sort in the column menu. Tabs, Pin, Pinned, Compare (schema, rows, cells), Queue, Problems, Graph and the column header menu (filter, hide, profile, Add as a step) are done (see `PROGRESS.md`).
3. **WB-14 and WB-15 remainder**: peek, pin a step, Invoke for function queries, delta chips beyond row counts, the Count rows setting, turning the chip's view filters into steps in one click, the operation history with Undo and the History popover, the multi-step preview popover, Auto-run steps after structural edits, the editor gutter band. F10 cursor, drag with per-gap checks, Insert step after and the 640 to 1099 px sheet are done (see `PROGRESS.md`).
4. **WB-19 UI**: Sources list in the top bar menu, binding up front, and the check before Run all.
5. **WB-20 editor intelligence**: completion (library names from `lib-names.js`, steps, queries, VBA), signature help, go to definition and find references (`refs.js` for VBA, `deps.js` for queries), the "no callers" note. Show `structure.js` problems as gutter markers and in the Download tooltip.
6. **WB-27 remainder**: `vba-big.xlsm` cannot be generated; measure the VBA outline on synthetic text in a unit test instead and say so.
7. **WB-28 acceptance story** from `06_WORKBENCH.md`: write the e2e that follows it step by step on `many-queries.xlsx`, regenerate the visual baselines for Phase 6 (32 extra), complete `PROGRESS.md`, and fill the manual matrix in `docs/observations.md` with *not run* where it was not run.

Definition of done: every item above built, `npm test` green (excluding what cannot run here, stated plainly), baselines reviewed by eye, `PROGRESS.md` complete. Only then tell the owner it is finished and that they may revoke the token.

## How to start in a fresh chat (about ten minutes)

1. Clone `beta` only: `git -c http.extraHeader=... clone --single-branch --branch beta https://github.com/datakid/power-query-manager.git quoin`, set the local identity, `npm install`, `git checkout package-lock.json`.
2. Write `/home/claude/pw.local.config.js` (above). `npm run test:lint`, `npm run test:unit`, then one detached browser run to see the baseline: about 249 pass (a long detached run can vanish; start it again).
3. Read `PROGRESS.md` from the bottom up (newest sections first) to learn what each module is called and where the tests are, then `06_WORKBENCH.md` for the item you take.
4. Suggested order: the rest of WB-16, WB-14 and WB-15, WB-10 remainder, WB-19, WB-20, WB-27, WB-28.
5. Each item: build, unit tests for the pure part, an e2e spec, lint, build the manifest, regenerate baselines if the UI changed, full browser run, document in `PROGRESS.md` (changed expectations, deviations, not done), commit with explicit paths, push `beta`, one line to the owner.

Observed and not fixed: at 390 px the top bar still gives the file name almost no room (the overflow menu of 02B §4.1 is not built).

## Plan files (read in this order)

`00_START_HERE.md`, `02_IDENTITY.md`, `02A_IDENTITY_AMENDMENT.md`, `02B_VISUAL_REFINEMENT.md`, `03_EDIT_RUN_SAVE.md`, `04_PRINT.md`, `05_TEST_PLAN.md`, `06_WORKBENCH.md`; progress and deviations in `PROGRESS.md`. Where two disagree: later letter wins for shape and size (`02B` over `02A` over `02`); behaviour comes from `03`, `04`, `06`.
