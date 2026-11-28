# quoin vNext — handover for a fresh chat

Read this first, then `FINISH_PLAN.md`. This file is short on purpose. Everything else is in the plan files listed at the end.

## Hard rules

1. Repo: `github.com/datakid/power-query-manager`. Work **only on the branch `beta`**. Do not read from, merge into, push to, or create any other remote branch (`fable`, `fable-scope` and `fable-writer` are another path: leave them alone). If the clone is not on `beta`, stop and fix that first.
2. No code comments, ever, in anything you write.
3. The owner supplies a GitHub token in chat when needed. Use it only as an HTTP header for `git` (`-c http.extraHeader="Authorization: Basic <base64 x-access-token:TOKEN>"`). Never write it into a file, a commit, a log or memory. Remind the owner to revoke it only when the whole plan is finished and confirmed.
4. Updates to the owner: one line per phase or milestone, in the style of a commit message, then carry on to the next item without asking. Do not write long reports mid-work. At the very end, one honest summary.
5. Stage explicit paths. The repo has no `.gitignore`: `git add -A` sweeps in `node_modules`, `dist` and `test-results`.
6. Never claim something is done that was not run. State what was not run.

## Sandbox facts

- No network access to Playwright's browser CDN. A Chromium exists at `/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`. The config for it is in the repo as `scripts/pw.sandbox.config.mjs` (use `-c scripts/pw.sandbox.config.mjs`); the older out-of-repo version is kept below for reference:

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

## Where the work stands and what is left

This file keeps the rules, the sandbox facts and the pitfalls. The state of the work and the plan to the end are in **`FINISH_PLAN.md`**: read it next. What each module is called, where its tests are, and every deviation are in `PROGRESS.md` (read it from the bottom up).

In one paragraph: the whole workbench phase is built on `beta`, written in two lines (the first by the first agent, the second by another agent from `95676d4`, delivered as a git bundle), reviewed, merged and corrected. What remains is review, the open deviations, the final gate and the honest summary, all listed in `FINISH_PLAN.md`.

## Plan files (read in this order)

`00_START_HERE.md`, `02_IDENTITY.md`, `02A_IDENTITY_AMENDMENT.md`, `02B_VISUAL_REFINEMENT.md`, `03_EDIT_RUN_SAVE.md`, `04_PRINT.md`, `05_TEST_PLAN.md`, `06_WORKBENCH.md`; progress and deviations in `PROGRESS.md`. Where two disagree: later letter wins for shape and size (`02B` over `02A` over `02`); behaviour comes from `03`, `04`, `06`.
