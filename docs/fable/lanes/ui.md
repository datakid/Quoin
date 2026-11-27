# Lane: ui

Plan part: F5-01, Firefox and WebKit. You own the result grid, the Set screen layout and the specs for them. The failures here are product bugs until proven to be an engine limit.

Read `docs/fable/OWNERSHIP.md` first. Its rules apply to you in full.

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
- `docs/fable/lanes/NOTES-ui.md` (your notes)

Not yours, read only: `src/app/**` (including `src/app/row-diff.js`), `src/ui/strings.js`, `tests/e2e/helpers.js`, `tests/__visual__/**`. If a fix needs a change there, write the exact change in your notes.

## Setup

Your clone is `/home/claude/lanes/ui`, port 5302. Run specs with `/home/claude/lanes/e2e-ui.sh tests/e2e/<spec>.spec.js`. Chromium only. Firefox and WebKit run only in CI. After a change under `src/` or `styles/` that a test needs the manifest for: `node scripts/build-manifest.mjs`, run, then `git checkout -- asset-manifest.json` before you commit.

## What failed in CI (run 45857877573, commit 6e513d2)

Log with full errors: `gh run view 45857877573 -R datakid/quoin --log-failed`.

| # | Test | Engine | Error in CI |
|---|---|---|---|
| 1 | `fable-matrix.spec.js:80` five thousand rows paint only the visible ones | WebKit | `.grid-row` count is 5000, expected under 80. Virtualisation is not applied |
| 2 | `fable-matrix.spec.js:96` the keyboard moves between cells and Tab leaves the table | Firefox | after Tab the grid is still focused |
| 3 | `fable-matrix.spec.js:124` dragging across cells extends the selection | Firefox | selection stays `{r1:0,r2:0,c1:0,c2:0}`, expected `{r1:0,r2:3,c1:0,c2:1}` |
| 4 | `grid.spec.js:46` selection and the copy event produce tab-separated text | Firefox | copied text is empty |
| 5 | `perf.spec.js:39` scrolling a 1,000,000 by 12 result stays smooth | Firefox | `stats.top` is 50394, expected over 100000 |
| 6 | `fable-row-diff.spec.js:111` on a phone the panes stack and the result and diff come into view | WebKit | a part's bottom is 1484.8 but the shell bottom is 797 |

## What to do, in this order

1. Item 1 first, it is the one the handover flagged. Look at `paint()` in `src/ui/grid.js` (rows between `first` and `last` from `scrollTop` and `clientHeight`) and at the scroll container rules in `styles/grid.css` and `styles/set.css` (`.set-result[data-matrix]` at lines 193 to 199 and 270). Probably `clientHeight` is 0 or the full height in WebKit under the test viewport because the container is not height-bounded. Find the cause from the code and a Chromium reproduction with a forced unbounded container before you change anything. The fix must give a bounded scroll container in every engine.
2. Item 6. The row-diff panes on a phone. Same files. Find which element is 1484 px tall and why the stack is not bounded by the shell.
3. Items 2 and 3. Read the keydown, mousedown, mousemove and mouseup handling in `grid.js`. Firefox differs in how it sets `event.buttons` on mousemove and in what `Tab` does when the grid calls `preventDefault`. Fix in `grid.js` if the handler relies on an engine-specific detail. Add a unit-level or Chromium spec that would have caught it where you can.
4. Item 4. Check whether the copy handler reads the selection when the event comes from a synthetic `ClipboardEvent` in Firefox. If the app handler is right and the test's synthetic event is what fails, change the test and say so in the notes.
5. Item 5. Firefox limits the height of a scrolled element (about 17.8 million px) and Chromium does not. 1,000,000 rows at the row height is above it. If the grid uses one tall spacer, scale the scroll range so the last row is reachable in every engine. If it is not that, find the actual cause. If you decide it is an engine limit, record it as Blocked with the number in your notes and skip by `browserName` with the reason.
6. Keep a table in `docs/fable/lanes/NOTES-ui.md`: item, root cause (one line), commit, verified (Chromium local, or "unverified until CI").

## Then (queue, in order, do not wait for me)

7. Phone and tablet audit of the Set screen at 320, 375 and 768 px wide with Chromium mobile emulation: no horizontal page scroll, no clipped controls, the result grid and the diff stay inside the shell. Add the assertions that fail on a regression to `fable-responsive.spec.js`. Fix what the audit finds in `styles/set.css`, `styles/grid.css` and `src/ui/set/**`.
8. Forced-colors and dark mode: check that grid selection, focus ring and status colours remain distinguishable in `forced-colors: active` and dark. Fix in `styles/grid.css` and `styles/set.css`. Add a Chromium spec case that emulates `forced-colors` and asserts the focus and selection rules are not colour-only.
9. Grid keyboard completeness: Home, End, PageUp, PageDown, Ctrl+Home, Ctrl+End, Shift+arrows, Ctrl+A, Ctrl+C on the grid. Make sure each works and has a test in `grid.spec.js` or `fable-matrix.spec.js`.
10. Write in the notes what you looked at and found fine, so it is not looked at twice.

## Ruled out

- Changing an expectation to make a Firefox or WebKit result pass, except item 4 if you prove the test is wrong.
- Touching `src/app/**`, `strings.js`, `helpers.js`, visual baselines.
- Reducing the 5000-row or 1,000,000-row cases to smaller ones.

## Done

- `fable-matrix`, `grid`, `grid-limits`, `perf`, `fable-row-diff`, `fable-responsive` and `tests/unit/grid-labels.test.js` pass on Chromium locally, run twice.
- A Chromium test exists that would fail on the WebKit virtualisation fault (for example one that forces the unbounded container), or the notes say why one cannot exist.
- Lint 0, unit 0 failures, `node scripts/check-ownership.mjs lane ui` prints `all owned`.
- Notes file written, last line `HAND BACK <commit hash>`.
