# Notes: harness lane

Written by the harness lane only. The integrator reads this and moves what matters into PROGRESS.md and MANAGER.md.

Brief: docs/fable/lanes/harness.md

## Changes

| Test | Engine | Decision | Reason | Verified |
|---|---|---|---|---|
| fable-apply-worker.spec.js:58, :71, :92 (and every other use of `expectSameOutput`) | Firefox, WebKit | fixed | The inner Power Query package in `customXml/item1.xml` holds a rewritten `Section1.m`, which each engine deflates in its own way, so the outer text differed while the content was the same. `zipDigest` now unpacks the package and hashes its entries, permissions, metadata and bindings, plus the XML text around the base64 body. Chromium keeps the exact byte check. | Chromium local: both specs pass. A scratch run with a different deflate (outside the repo) differed from Node only in `customXml/item1.xml` under the old digest, was equal under the new one, and a different recipe text still gave a different digest. Firefox and WebKit: unverified until CI |
| fable-recipe-tokens.spec.js:62 | Firefox, WebKit | fixed | `grantPermissions` and `clipboard.readText` are Chromium only. Chromium keeps the real clipboard read-back. The other engines stub `navigator.clipboard.writeText` in the page and check the token passed and the Copied status. The real clipboard write is not exercised there. | Chromium local for the real path. The stub path ran on Chromium with a throwaway copy of the spec, since removed. Firefox and WebKit: unverified until CI |
| print.spec.js:86, :103 | Firefox, WebKit | skipped | `page.pdf` is only supported by headless Chromium in Playwright | Chromium local: both pass |
| refinement.spec.js:60 | Firefox | skipped | Playwright does not support the `isMobile` context option in Firefox. The skip is Firefox only, so WebKit keeps running it. | Chromium local: passes. Skip itself unverified until CI |
| privacy.spec.js:127, :151 | WebKit | skipped | Playwright WebKit fails `page.reload` and `page.goto` after `setOffline(true)` with an internal error. I took the cause from the CI error text and could not reproduce WebKit here. | Chromium local: both pass. Skip itself unverified until CI |
| safety.spec.js:13 | Firefox | fixed (attempt) | A real key press now comes before the reload, because Firefox only shows `beforeunload` after user activation. The app installs a standard listener in `leaveGuard` (`main.js`), so this is not an app finding unless CI still fails. | Chromium local: passes. Firefox: unverified until CI |

Skips use an engine-specific condition for items 4 and 5 instead of `browserName !== 'chromium'`, so they keep the engines that passed in CI. All skips start with `test.skip(browserName`, so one grep lists them.

## Open

- Offline start in real Safari is not verified by any test. The two WebKit offline skips remove the only coverage.
- Item 6 depends on CI. If Firefox still shows no `beforeunload` after the key press, the next step is to trigger the reload from the page, and if that fails too it is a skip with a reason, not a guess made here.
- Item 1 depends on CI. If the digests still differ after this change, the difference is in decoded content, and then `src/` is the cause and the integrator decides.
- Firefox and WebKit run only in CI. Local Chromium was a Chromium 141 build from the npm package `@sparticuz/chromium`, kept outside the repo, because the Playwright download is blocked in this environment.

## Needed from another owner

Nothing.

HAND BACK 7bdec5d
