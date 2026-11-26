# Ownership: who edits what

Written 2026-11-26 by the integrator. Machine-readable copy: `docs/fable/ownership.json`. This file overrides the lane text in `MANAGER.md` section 3 and in `docs/fable/handover/` until the integrator says otherwise in `MANAGER.md`.

The rule: one owner per file. A lane edits only the paths listed for it. Every other path belongs to the integrator. If a lane needs a change in a file it does not own, it does not make it. It writes the exact change into its notes file and the integrator applies it or hands it to the owner.

## The lanes

| Lane | Owns | Does not touch | Brief |
|---|---|---|---|
| integrator | everything not listed for a lane: `src/app/**`, `src/workers/**`, `src/batch/**`, `src/ui/strings.js`, `src/core/**` except `save.js` and `sheet/**`, `docs/**` except the lane notes, `asset-manifest.json`, `tests/lint/**`, `tests/fixtures/**`, `tests/unit/**` except the lane tests, `tests/__visual__/**`, `scripts/**`, `.github/workflows/ci.yml`, `openxml.yml`, `perf.yml`, `package*.json` | the paths below | this file |
| harness | `playwright.config.js`, `.github/workflows/browsers.yml`, `tests/e2e/helpers.js`, and the specs for apply and collect worker, recipe tokens, print, refinement, privacy, safety | `src/**`, `styles/**` | `docs/fable/lanes/harness.md` |
| ui | `src/ui/grid.js`, `src/ui/set/**`, `styles/grid.css`, `styles/set.css`, and the specs for matrix, grid, grid limits, perf, row diff, responsive | `src/app/**`, `src/ui/strings.js`, `tests/e2e/helpers.js` | `docs/fable/lanes/ui.md` |
| safety | `src/core/save.js`, `src/core/sheet/**`, `tests/unit/sheet-*.test.js`, `tests/unit/save-safety.test.js` | `src/batch/**`, `src/app/**`, anything in `src/core/` outside `sheet/` and `save.js` | `docs/fable/lanes/safety.md` |

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
10. When you finish, write the notes file: what you changed (file and commit hash), what you proved and how, what is still open, what you need from another owner. Short lines, no narrative. Then stop. The last line of the notes file is `HAND BACK <commit hash>`.

## How to run things

- Unit tests and lint, from your clone: `node tests/lint/run.js` and `node --test tests/unit/*.test.js`.
- Local Chromium specs: `/home/claude/lanes/e2e-<lane>.sh tests/e2e/<spec>.spec.js`. Every lane has its own port, so lanes can run at the same time.
- After a change under `src/` or `styles/` that a test reads the manifest for: `node scripts/build-manifest.mjs`, run the tests, then `git checkout -- asset-manifest.json`.

## What the integrator does

- Merges each lane's commits into `fable` in the order they finish. The lanes touch different files, so these merges do not conflict. A conflict means a lane broke its list, and the lane's commit is sent back.
- Regenerates `asset-manifest.json`, runs lint, unit tests and the lane specs on the merged tree, then pushes `fable`.
- Reads the CI result for Firefox and WebKit and sends what still fails to the lane that owns the file.
- Records the results in `PROGRESS.md` and `MANAGER.md`.
- Holds what is held: F3-08 (in place) and F3-09 (Excel computes on open) are not merged without the user's approval. The three section 9 decisions are the user's.
