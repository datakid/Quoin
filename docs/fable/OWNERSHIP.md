# Ownership: who edits what

Written 2026-11-26 by the integrator. Machine-readable copy: `docs/fable/ownership.json`. This file overrides the lane text in `MANAGER.md` section 3 and in `docs/fable/handover/` until the integrator says otherwise in `MANAGER.md`.

The rule: one owner per file. A lane edits only the paths listed for it. Every other path belongs to the integrator. If a lane needs a change in a file it does not own, it does not make it. It writes the exact change into its notes file and the integrator applies it or hands it to the owner.

## The lanes

| Lane | Owns | Does not touch | Brief |
|---|---|---|---|
| integrator | everything not listed for a lane: `src/app/**`, `src/workers/**`, `src/batch/execute/index.js`, `collect.js`, `run-file.js`, `src/batch/recipe/**`, `src/batch/index/**`, `src/ui/strings.js`, the rest of `src/core/`, `docs/**` except the lane notes, `asset-manifest.json`, `tests/lint/**`, `tests/fixtures/**`, `tests/unit/**` except the lane tests (see `ownership.json`), `tests/__visual__/**`, `scripts/**`, `.github/workflows/ci.yml`, `openxml.yml`, `perf.yml`, `package*.json` | the paths below | this file |
| harness | `playwright.config.js`, `.github/workflows/browsers.yml`, `tests/e2e/helpers.js`, and the specs for apply and collect worker, recipe tokens, print, refinement, privacy, safety | `src/**`, `styles/**` | `docs/fable/lanes/harness.md` |
| ui | `src/ui/grid.js`, `src/ui/set/**`, `styles/grid.css`, `styles/set.css`, and the specs for matrix, grid, grid limits, perf, row diff, responsive | `src/app/**`, `src/ui/strings.js`, `tests/e2e/helpers.js` | `docs/fable/lanes/ui.md` |

Each lane also owns its own notes file, `docs/fable/lanes/NOTES-<lane>.md`. Only that lane writes it. The integrator reads it and moves what matters into `PROGRESS.md` and `MANAGER.md`.

Shared files and who changes them:

| File | Changed by | How a lane asks for a change |
|---|---|---|
| `asset-manifest.json`, `dist/` | integrator, after the merge | never commit them; run `node scripts/build-manifest.mjs` to test, then `git checkout -- asset-manifest.json` before committing |
| `src/ui/strings.js` | integrator | write the keys and text into the notes file |
| `src/app/main.js`, `src/app/**` | integrator | write the call or field the lane needs into the notes file |
| `tests/__visual__/**` | CI only | never regenerate by hand |
| `PROGRESS.md`, `MANAGER.md`, `README.md`, `docs/observations.md` | integrator | send the summary in the notes file |
| `tests/e2e/helpers.js` | harness | other lanes ask in their notes; harness changes are additive, existing exports keep their behaviour |

## Rules for every lane

1. Work in your own clone under `/home/claude/lanes/<lane>`, on the local branch `fable`. Do not push. Do not create, rename or delete branches. Do not touch `beta`.
2. No code comments anywhere (lint T-LINT-1).
3. Read your brief first, then this file, then the files you own. Stay inside your list. Before you hand back, run `node scripts/check-ownership.mjs lane <lane>`. It must print `all owned`.
4. Before you hand back: `node tests/lint/run.js` shows 0 findings, `node --test tests/unit/*.test.js` shows 0 failures (5 skipped is the baseline), and every spec you own passes on Chromium.
5. Commit often, one change per commit. Commit messages are short, git style, no narrative. End each with the two lines:
   `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
   `Claude-Session: https://claude.ai/code/session_017acr3ZGNZottDZaKToYW4f`
6. Firefox and WebKit cannot run here. Only CI runs them. A change that targets those engines is marked in your notes as "unverified until CI" and is never described as fixed.
7. Do not fix a failing test by changing its expectation. A test changes only when your brief names that change, or when the notes file records why the expectation was wrong.
8. Do not chase `T-WB-05` and `T-WB-09`. They are flaky timing tests.
9. When a Playwright run takes more than two minutes, start it with `nohup`, write to a log, and poll the log. Never put `pkill -f "playwright test"` in the same command as the run.
10. Never wait for the integrator. Work your brief top to bottom, then the queue under "Then" in your brief. An item that needs a file you do not own is written into your notes with the exact change and you move to the next item. Stop only when the queue is empty or every remaining item is blocked.
11. When you finish, write the notes file: what you changed (file and commit hash), what you proved and how, what is still open, what you need from another owner. Short lines, no narrative. Then stop. The last line of the notes file is `HAND BACK <commit hash>`.

## How to run things

- Unit tests and lint, from your clone: `node tests/lint/run.js` and `node --test tests/unit/*.test.js`.
- Local Chromium specs: `/home/claude/lanes/e2e-<lane>.sh tests/e2e/<spec>.spec.js`. Every lane has its own port, so lanes can run at the same time.
- After a change under `src/` or `styles/` that a test reads the manifest for: `node scripts/build-manifest.mjs`, run the tests, then `git checkout -- asset-manifest.json`.

## Agents in their own sessions: Writer and Scope

Writer (branch `fable-writer`) and Scope (branch `fable-scope`) run in the user's own sessions, not in this clone. They have rows in `ownership.json` (`writer`, `scope`) and briefs: `docs/fable/lanes/writer.md`, `docs/fable/lanes/scope.md`. They work on their own existing branch, merge `origin/fable` before each push, never rebase, never force-push, never create a branch. The integrator merges their branches into `fable`. The trunk agent is finished: its work is merged and its handover is `docs/fable/handover/HANDOVER.md`.

| Where | Owner | Rule |
|---|---|---|
| `src/core/save.js`, `src/core/sheet/**`, the `sheet-*`, `save-safety` and `batch-naming` tests | scope | the safety lane never ran; Scope took it over on 2026-11-27 (milestone S1); Writer reviews and sends changes in its notes |
| `src/core/pq/**`, `src/core/vba/**`, `changes.js`, `replace.js`, the writer tests | writer | no one else edits them |
| `src/batch/resolve/**`, `units.js`, `transform.js`, `combine.js`, `src/core/export/xlsx.js`, the scope tests | scope | no one else edits them |
| `src/batch/execute/index.js`, `collect.js`, `run-file.js` | integrator | Writer's three lines (commit `30e7599`) and Scope's two lines (the `withInjectTokens` import and call) are accepted exceptions; everything else is requested in notes |

Work with no lane yet:

| Open work | Owner | Why it is not running |
|---|---|---|
| F4-03 wiring (`createRecipeStore` in `main.js`, Stored recipes list, `rememberSet`), F4-02, F4-04 | integrator, after the ui lane is merged | `main.js` and `strings.js` are integrator files and the ui lane owns `src/ui/set/**` for now |
| D2 (hide `unchanged` rows by default with a count and a filter), strings for Scope's codes, the closing run message when every non-changed row is skipped | integrator, after Scope's clean tree is merged | the codes must exist in code before the strings (lint T-E-11 rejects unused keys) |
| Browser specs for F2-04 to F2-09 (query remove and rename, module replace, replace in code, align) | not assigned | needs a decision on who owns new `tests/e2e/` files for Writer's cards |
| F3-08 in place, F3-09 Excel computes on open | nobody | held until X03 and the other Excel results exist (D4) |
| Writer's recipe field for `connect` | nobody | held until the user reports pack 3 case 02 from Excel |

## What the integrator does

- Merges each lane's commits into `fable` in the order they finish. The lanes touch different files, so these merges do not conflict. A conflict means a lane broke its list, and the lane's commit is sent back.
- Regenerates `asset-manifest.json`, runs lint, unit tests and the lane specs on the merged tree, then pushes `fable`.
- Reads the CI result for Firefox and WebKit and sends what still fails to the lane that owns the file.
- Records the results in `PROGRESS.md` and `MANAGER.md`.
- Holds what is held: F3-08 (in place) and F3-09 (Excel computes on open) are not merged without the user's approval. The three section 9 decisions are the user's.
