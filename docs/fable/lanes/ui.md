# Lane: ui

Agent: the trunk agent, on branch `fable-trunk-handover` (it finished the harness lane, `NOTES-harness.md`). Plan part: F5-01, Firefox and WebKit, then F5-02 follow-up. You own the result grid, the Set screen layout, the Preview path in `plan-run.js` and the specs for them. A failure here is a product bug until it is proven to be an engine limit.

Read `docs/fable/OWNERSHIP.md` and `docs/fable/ROADMAP.md` first. Their rules apply to you in full. Branch rules are the ones in `lanes/writer.md` ("How you work"): your own existing branch, merge `origin/fable` before each push, never rebase or force-push, no new branch, push after each milestone. Your harness work is merged into `fable` (`00c322c`).

How you verify: Chromium locally as you did for the harness lane; Firefox and WebKit through `browsers.yml` with `workflow_dispatch` and the `spec` input, so one spec runs in minutes. A fix for one engine is "fixed" only after that engine's run is green; until then it is "unverified until CI".

If you are starting in a new chat: read `docs/fable/AGENTS.md` first (section "Picking up in a new chat"), then this brief, then the `## State` block at the top of `docs/fable/lanes/NOTES-ui.md`. Keep that block current at every push, in the format AGENTS.md gives. Continue at the first milestone below that the notes do not mark done.

## Your files

- `src/ui/grid.js`
- `src/ui/set/**` (`result-matrix.js`, `shell.js`, `variants.js`, `recipe-panel.js`)
- `styles/grid.css`
- `styles/set.css`
- `tests/e2e/fable-matrix.spec.js`
- `tests/e2e/grid.spec.js`
- `tests/e2e/grid-limits.spec.js`
- `tests/e2e/perf.spec.js`
- `tests/e2e/fable-row-diff.spec.js`
- `tests/e2e/fable-responsive.spec.js`
- `tests/unit/grid-labels.test.js`
- `src/app/plan-run.js`, `tests/unit/plan-run.test.js`, `tests/e2e/fable-perf.spec.js`, `docs/fable/performance.md` (for U2)
- `docs/fable/lanes/NOTES-ui.md` (your notes)

Not yours, read only: the rest of `src/app/**` (including `src/app/row-diff.js`), `src/ui/strings.js`, `tests/e2e/helpers.js`, `tests/__visual__/**`. If a fix needs a change there, write the exact change in your notes.

## What is left in CI (your own notes, run 46033109587 on `c5914ae`)

| # | Test | Engine | Error |
|---|---|---|---|
| 1 | `fable-row-diff.spec.js:111` on a phone the panes stack and the result and the diff come into view | WebKit | a pane bottom is 1484.8, the shell bottom 797 |
| 2 | `fable-matrix.spec.js:96` the keyboard moves between cells and Tab leaves the table | Firefox | grid still focused after Tab |
| 3 | `fable-matrix.spec.js:124` dragging across cells extends the selection | Firefox | selection stays on one cell |
| 4 | `grid.spec.js:46` selection and the copy event produce tab-separated text | Firefox | copied text empty |
| 5 | `perf.spec.js:39` scrolling 1,000,000 rows by 12 columns | Firefox | scroll top 50394, expected over 100000 |
| 6 | `fable-matrix.spec.js:80` five thousand rows paint only the visible ones | WebKit | passed in one run and painted 5000 rows in another: timing dependent |

## Milestones (work them in this order, do not wait for me)

**U1. Firefox and WebKit to zero.** Fix items 1 to 6 at the root: read `src/ui/grid.js`, `styles/grid.css`, `styles/set.css` and reproduce the engine-specific condition in Chromium where you can (a forced unbounded container, synthetic events, a narrower viewport). Item 6 first: find what makes the paint depend on timing (the scroll container's height before layout, a missing resize or first-paint measure) and make it deterministic. Item 5: Firefox limits the height of a scrolled element to about 17.8 million px; 1,000,000 rows at the row height is above it; scale the scroll range so the last row is reachable in every engine, and say so in the notes. If an item is a Playwright or engine limit, record it as Blocked with the evidence and skip by engine with the reason, never by changing an expectation. Acceptance: a whole-suite `browsers.yml` run with Firefox and WebKit at 0 failed, run ids in the notes.

**U2. The Preview stall at 2,000 files.** `docs/fable/performance.md` records a 484 ms stall with the cause unknown. Scope measured `resolvePlan` in node at 20 to 25 ms for 2,000 index entries, so the time is in `src/app/plan-run.js` or the report or the ui (`MESSAGES-scope.md`, the last section). Profile one Preview at 2,000 files in Chromium (DevTools protocol, a CPU profile of the main thread), name the function, fix it, and record before and after in `performance.md`. Acceptance: the stall is measured again at 2,000 and 5,000 files, the numbers are in the doc, `plan-run` tests and the Preview specs pass.

**U3. Phone and tablet audit** of the Set screen at 320, 375 and 768 px wide: no horizontal page scroll, no clipped controls, grid and diff inside the shell. Add assertions to `fable-responsive.spec.js` that fail on a regression and fix what they find in your CSS.

**U4. Forced colors and dark.** Selection, focus and status colours stay distinguishable in `forced-colors: active` and dark. Add a Chromium spec case that emulates `forced-colors` and asserts that focus and selection are not colour only.

**U5. Grid keyboard completeness.** Home, End, PageUp, PageDown, Ctrl+Home, Ctrl+End, Shift+arrows, Ctrl+A, Ctrl+C: each works and has a test. Then write in the notes what you looked at and found fine.

**U6. Hide `unchanged` rows by default (the user's decision D2).** In the result grid of Preview and of the report, rows whose verdict is `unchanged` are hidden by default, with a line above the grid that says how many are hidden and a button that shows them. Strings are ready in `src/ui/strings.js`: `S.matrixHiddenCount(n)`, `S.matrixShowUnchanged`, `S.matrixHideUnchanged`. Rules: the CSV report and `report.csv` still hold every row (they are built outside your files and must not change); the row index that `onSelectRow` passes to `src/app/main.js` (`rowDiff(preview, i)`) must stay the index in the full row list, so keep a visible-to-source map in `ResultMatrix`; the toggle is a real button with `aria-pressed`, keyboard reachable, with its state kept when the grid redraws; when no row is unchanged the line and the button are not drawn; the count is in the live region the grid already uses or in a new one, and axe passes in both themes. Spec: add cases to `fable-matrix.spec.js` (hidden by default, count correct, toggle shows them, selecting a row after the toggle opens the right diff, report CSV still has every row). Any string you need beyond those three goes in your notes with the exact text, the integrator adds it.

After U6, take the docs lane (`lanes/docs.md`). Do not stop between milestones: a milestone that waits for CI is paused, and the next one starts while the run is going.

## Ruled out

- Changing an expectation to make a Firefox or WebKit result pass, except item 4 if you prove the test is wrong.
- Touching `src/app/**`, `strings.js`, `helpers.js`, visual baselines.
- Reducing the 5000-row or 1,000,000-row cases to smaller ones.

## Done

- `fable-matrix`, `grid`, `grid-limits`, `perf`, `fable-row-diff`, `fable-responsive` and `tests/unit/grid-labels.test.js` pass on Chromium locally, run twice.
- A Chromium test exists that would fail on the WebKit virtualisation fault (for example one that forces the unbounded container), or the notes say why one cannot exist.
- Lint 0, unit 0 failures, `node scripts/check-ownership.mjs lane ui` prints `all owned`.
- Notes file written, last line `HAND BACK <commit hash>`.
