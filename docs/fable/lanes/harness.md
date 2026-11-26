# Lane: harness

Plan part: F5-01, Firefox and WebKit. You own the test harness and every failure there that comes from a test, a Playwright limit or an engine limit.

Read `docs/fable/OWNERSHIP.md` first. Its rules apply to you in full.

## Your files

- `playwright.config.js`
- `.github/workflows/browsers.yml`
- `tests/e2e/helpers.js`
- `tests/e2e/fable-apply-worker.spec.js`
- `tests/e2e/fable-collect-worker.spec.js`
- `tests/e2e/fable-recipe-tokens.spec.js`
- `tests/e2e/print.spec.js`
- `tests/e2e/refinement.spec.js`
- `tests/e2e/privacy.spec.js`
- `tests/e2e/safety.spec.js`
- `docs/fable/lanes/NOTES-harness.md` (your notes)

Not yours, read only: everything under `src/`, `styles/`, every other spec. Other lanes' specs import `tests/e2e/helpers.js`: your changes there are additive, an existing export keeps its behaviour.

## Setup

Your clone is `/home/claude/lanes/harness`, port 5173 (privacy.spec.js hardcodes it). Run specs with `/home/claude/lanes/e2e-harness.sh tests/e2e/<spec>.spec.js`. Chromium only. Firefox and WebKit run only in CI.

## What failed in CI (run 45857877573, commit 6e513d2)

Log with full errors: `gh run view 45857877573 -R datakid/quoin --log-failed`.

| # | Test | Engines | Error in CI | Likely class |
|---|---|---|---|---|
| 1 | `fable-apply-worker.spec.js:58`, `:71`, `:92` | Firefox, WebKit | `expectSameOutput` at `helpers.js:131`: the digest of `customXml/item1.xml` differs between the worker's output and Node's. All other entries match | test comparison |
| 2 | `fable-recipe-tokens.spec.js:62` | Firefox, WebKit | `grantPermissions: Unknown permission: clipboard-write` | Playwright limit |
| 3 | `print.spec.js:86`, `:103` | Firefox, WebKit | `page.pdf: PDF generation is only supported for Headless Chromium` | Playwright limit |
| 4 | `refinement.spec.js:60` | Firefox | `options.isMobile is not supported in Firefox` | Playwright limit |
| 5 | `privacy.spec.js:127`, `:151` | WebKit | `page.reload` and `page.goto` fail with "WebKit encountered an internal error" after `setOffline(true)` | engine or Playwright limit, confirm |
| 6 | `safety.spec.js:13` | Firefox | `beforeunload` is never seen after `page.reload()` on a dirty session | engine rule or test, confirm |

## What to do

1. Item 1. `customXml/item1.xml` holds the Power Query package. Find out what in it depends on the engine. The likely cause is a compressed inner package, so the outer text differs while the content is the same. Make `zipDigest` compare that part by its decoded content (unpack the package and hash its entries) on non-Chromium engines. Chromium keeps the exact byte check. If the difference is not a compression artifact, stop and write it in your notes with the two decoded values, because then `src/` is the cause and the integrator decides.
2. Items 2, 3, 4: skip by `browserName` with a one-line reason. For item 2, prefer testing the copy without `grantPermissions` on the engines where that is possible, and skip only where it is not.
3. Item 5: check Playwright's known WebKit limits for offline plus service worker. If it is a limit, skip WebKit with the reason. In your notes say plainly that offline start in real Safari is not verified.
4. Item 6: Firefox only fires `beforeunload` after user activation. Try a real click or key press on the page before the reload. If the page installs no listener on Firefox, that is an app finding: write it in your notes and do not skip.
5. Every skip uses the same form so the integrator can list them: `test.skip(browserName !== 'chromium', 'reason')` at the top of the test, with the reason naming the engine and the cause.
6. In `docs/fable/lanes/NOTES-harness.md`, keep a table: test, engine, decision (fixed, skipped, app finding), reason, verified (Chromium local or "unverified until CI").

## Ruled out

- Changing any expectation to make a Firefox or WebKit result pass, other than the digest rule in item 1.
- Touching `src/`, `styles/` or another lane's spec.
- Regenerating visual baselines.

## Done

- All your specs pass on Chromium locally, run twice.
- Lint 0, unit 0 failures, `node scripts/check-ownership.mjs lane harness` prints `all owned`.
- Notes file written, last line `HAND BACK <commit hash>`.
