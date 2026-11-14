# Fable progress

## Phase F0 — Set

### Baseline (beta at 9afea2a, recorded in F0-01)

- Lint: 0 findings.
- Unit: 928 tests, 923 pass, 0 fail, 5 skipped locally; CI shows 922 pass, 6 skipped. One CI unit step failed once with no cause found and passed on every other run.
- Browser on CI (ubuntu-24.04, Chromium 141): 171 pass, 42 fail.
  - 36 are visual baselines (`visual.spec.js`, T-I-04). The stored images do not match Linux rendering.
  - 6 are not visual and are listed under Blocked.
- Local browser runs use a Chromium taken from the npm package `@sparticuz/chromium` outside the repo, through an untracked `playwright.local.config.js`. Playwright's own browser download is blocked in the build sandbox. Local rendering differs from CI, so local results never replace baselines.
- `docs/next/PROGRESS.md` already says T-E-12 and T-P-14b could not run in the beta build sandbox, so the keyboard spec was not verified after WB-13.

### F0-00 CI workflow (not in the plan)
Layer: repository
Files: .github/workflows/ci.yml, scripts/ci-annotate.sh, .gitignore
Do: run lint, unit and Playwright on every push and pull request to fable. Condense failures into check annotations because job logs cannot be fetched from the build sandbox.
Result: Done
Deviations: the plan has no CI task. Added because no browser can be installed in the build sandbox.

### F0-01 Baseline and comment sweep
Layer: repository
Files: tests/lint/checks.js, tests/unit/lint-rules.test.js
Do: record the baseline above; T-LINT-1 sweep found 0 comments; extend T-LINT-1 to `.yml`, `.yaml` and `_headers`; stop treating a `#!` first line as a comment.
Test that fails without it: `tests/unit/lint-rules.test.js` (9 tests; 0 pass, 1 fail with the old `checks.js`, which has no `commentFindings`).
Result: Done
Fails without: yes
Changed expectations: none
Deviations: none
Not re-verified: the plan's §2 table (G1 to G17) has not been re-checked row by row against the checkout. Only G9, G14 and G15 were touched.

### F0-02 Fable docs folder
Result: Partly done. `01_PLAN.md` is a verbatim copy of the plan. `00_FABLE.md` is Blocked.

### Blocked
- `quoin-fable.md` (the decision document) has not been supplied, so `docs/fable/00_FABLE.md` cannot be written and tasks citing Fable §3.3, §6.1, §9, §12 and §15 cannot start (F0-12, F3-02, F3-10).
- Six browser tests fail on beta and need an owner. They sit in beta's Phase 6 area, so the decision is whether beta's other agent fixes them and Fable takes the fix by merge, or Fable fixes them here. Editing any of these tests needs the user's approval (§11.3).
  - `keyboard.spec.js:57`: the shortcut sheet is generated from the command registry and lists "Alt+Up" and "Alt+Down" as two rows; the test expects one row "Alt+Up / Alt+Down". Reproduced locally. Stale test expectation.
  - `steps-panel.spec.js:78`: after "Move and rewire", "Added Custom" is still after "Changed Type" in the editor text. Reproduced locally and on CI.
  - `store.spec.js:60`: cancelling a batch with an endless query returns `ok` instead of `cancelled`. Reproduced locally and on CI.
  - `palette.spec.js:46` and `:69`, `keyboard.spec.js:9`: fail on CI only or intermittently; `palette.spec.js:46` and `keyboard.spec.js:9` pass locally. Not reproduced.

### Deviations
- See F0-00.
