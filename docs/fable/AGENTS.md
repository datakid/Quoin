# Agents: who is who, where each plan is, how to pick up

Written 2026-11-28 by the integrator. This is the first file a new chat reads. It is kept current at every merge. If it disagrees with an older handover file, this file wins.

Repo: `datakid/Quoin` (renamed from `power-query-manager`; GitHub redirects the old name). Trunk is branch `fable`. `beta` and `main` are never touched. No new branches. A token is never written into a file, a commit or memory; if a push needs access, ask the user to attach the repo to the session.

## The four agents

| Agent | Branch | Lanes | The plan (brief) | State (notes) | History only |
|---|---|---|---|---|---|
| Integrator (Claude on `fable`) | `fable` | everything not listed for a lane | `docs/fable/ROADMAP.md`, `docs/fable/DECIDED.md`, `docs/fable/MANAGER.md` section 6, `docs/fable/OWNERSHIP.md` | the status table below, `docs/fable/PROGRESS.md` | `docs/fable/HANDOVER.md` |
| Trunk agent | `fable-trunk-handover` | `harness` (finished), `ui`, `docs` | `docs/fable/lanes/ui.md` (U1 to U6), then `docs/fable/lanes/docs.md` (D1 to D4) | `docs/fable/lanes/NOTES-ui.md`, `NOTES-docs.md`, `NOTES-harness.md` | `docs/fable/handover/HANDOVER.md`, `MESSAGES-trunk.md` |
| Writer | `fable-writer` | `writer` | `docs/fable/lanes/writer.md` (W1 to W6) | `docs/fable/lanes/NOTES-writer.md`, `PROGRESS-writer.md`, `MESSAGES-writer.md` | `docs/fable/HANDOVER-writer.md` |
| Scope | `fable-scope` | `scope` | `docs/fable/lanes/scope.md` (S1 to S5) | `docs/fable/lanes/NOTES-scope.md`, `PROGRESS-scope.md`, `MESSAGES-scope.md` | `docs/fable/HANDOVER-scope.md`, `REMAINING-WORK-scope.md` |

Who owns which file: `docs/fable/ownership.json`. Check with `node scripts/check-ownership.mjs who <files>`, and before handing back with `node scripts/check-ownership.mjs lane <lane> origin/fable`. A file has one owner. A change to a file you do not own is written in your notes with the exact change; the owner applies it.

## Picking up in a new chat

The user says "continue quoin" and names the agent. The new chat then does exactly this and nothing else first:

1. Read this file, then the agent's brief, then the `## State` block at the top of the agent's notes file.
2. `git fetch origin`, check out the agent's own branch, `git merge origin/fable` (never rebase, never force-push).
3. Run `node tests/lint/run.js` and `node --test tests/unit/*.test.js` to see the baseline (lint 0 findings, unit 0 failures, 5 skipped).
4. Continue at the first milestone in the brief that is not marked done in the notes. Push to the agent's own branch after every milestone. Do not wait for the integrator.

Paste-ready lines:

- Trunk agent: `Continue quoin as the trunk agent (branch fable-trunk-handover). Read docs/fable/AGENTS.md, docs/fable/lanes/ui.md and the State block of docs/fable/lanes/NOTES-ui.md. Merge origin/fable, continue at the first milestone not done (U1 to U6, then docs.md D1 to D4), push after each milestone, do not wait for me.`
- Writer: `Continue quoin as Writer (branch fable-writer). Read docs/fable/AGENTS.md, docs/fable/lanes/writer.md and the State block of docs/fable/lanes/NOTES-writer.md. Merge origin/fable, continue at the first milestone not done (W1 to W6), push after each milestone, do not wait for me.`
- Scope: `Continue quoin as Scope (branch fable-scope). Read docs/fable/AGENTS.md, docs/fable/lanes/scope.md and the State block of docs/fable/lanes/NOTES-scope.md. Merge origin/fable, continue at the first milestone not done (S1 to S5), push after each milestone, do not wait for me.`
- Integrator: `Continue quoin as the integrator. Read docs/fable/AGENTS.md, ROADMAP.md, DECIDED.md and MANAGER.md section 6. Fetch all branches, merge what finished by the ownership rules, run lint and unit tests, regenerate the manifest, push fable, read CI, route each failure to its owner.`

## Handover at any moment

Nothing lives only in a chat. Every agent keeps a `## State` block at the top of its notes file and rewrites it at every push:

```
## State
Updated: <date> at <commit on my branch>
Milestone: <id and name> (in progress | done | blocked)
Last green commit on my branch: <hash>
Next action: <one line, specific enough to start without asking>
Blocked on: <none | what, and which owner>
Uncommitted work: <none | path of the saved patch>
```

Milestones done are marked in the brief's own table in the notes (id, commit, how it was checked). If a session ends in the middle of a task, the unfinished work is committed to the agent's branch as a commit whose subject starts `WIP:`, so the next chat finds it in `git log` and in `Uncommitted work`.

## Status of each agent

Updated by the integrator at each merge. As of `fable` `a9422d3` (2026-11-28).

| Agent | Done and merged | In progress or next | Waiting on |
|---|---|---|---|
| Integrator | merges of Writer `8dc0644`, Scope `1ab7281` (squashed, F3-08 and F3-09 history kept out), trunk harness `00c322c`; strings for Scope's codes; closing run message; Open XML check fix; ownership, roadmap, decisions, this file | merge trunk's UI work when U1 finishes; CI loop; I4 check of `FINAL-GATE.md` | trunk U1, D3 |
| Trunk agent | harness lane (browsers CI summary, skip helpers, specs; `NOTES-harness.md`) | U1: probe commit `bc5d5c9` on its branch ("temporary, removed next"); then U2 to U6, then D1 to D4 | nothing |
| Writer | queue items 1 to 5 (pack split, check audit, corpus tests, one-page Excel README); W1 kit and results reader (`9be5a03`) | the second pack's zip (`DECIDED.md` item 13), then W2, W3, W4 (S1 is on `fable`), W5, W6 | nothing |
| Scope | S1 (`940a3b8`: sheet-write trust gate, numFmts refusal fixed, UTF-16 sheet names), S2 (`1ab7281`: Transform over the whole corpus) | S3 to S5 in `lanes/scope.md` | nothing |

Needs a person, and blocks no agent: the Excel sitting with Writer's kit (`DECIDED.md` item 5). Everything else the user used to be asked is decided in `DECIDED.md`.

## The quality bar for every agent

The plan sets it, and nothing here lowers it. The integrator holds each lane to it at merge time and sends work back that does not meet it.

- A milestone is done only with evidence in the notes: the command or spec, its result, the commit. "Looks right" is not evidence.
- Every new test is shown to fail without the change it covers (break the code once in a scratch copy, run the test, restore). The notes say how.
- No existing test is weakened, skipped, deleted or given a looser expectation unless the brief names it or the notes record why the expectation was wrong.
- Firefox and WebKit are fixed only when a `browsers.yml` run on the branch is green for them. Until then the notes say "unverified until CI".
- No code comments anywhere (lint T-LINT-1). Lint 0 findings and unit 0 failures before every push. Ownership check clean before every hand back.
- Section 10 of the plan (the definition of done) and `docs/fable/FINAL-GATE.md` are the standard for the whole project. A claim in a doc is checked against code or a test.
- Nothing about real Excel is written as true except what `docs/observations.md` records.
- Held work stays out of the tree: F3-08 (in place) and F3-09 (Excel computes) until the in-place Excel case passes in desktop Excel.
- The three section 9 style decisions are not reopened (`DECIDED.md`); a new question that the plan does not answer is written in the notes and the integrator decides from the plan.

## Integrator: how to resume (state as of `fable` `c9b7b88`, 2026-11-28)

State block:

```
Updated: 2026-11-28 at c9b7b88
Milestone: I2 merge each push, I3 CI loop (in progress, no end date)
Last green commit on my branch: c9b7b88 (ci success, perf skipped)
Next action: fetch the three agent branches and merge whatever finished (see "Next, in order")
Blocked on: none
Uncommitted work: none (tree clean and pushed)
```

Next, in order:

1. Fetch. Merge the trunk agent when U1 is proven: a whole-suite `browsers.yml` run on `fable-trunk-handover` with Firefox and WebKit at 0 failed. Last seen: run 46144031367 on `aeee8aa` had 1 Firefox failure (`fable-matrix.spec.js:138` drag selection) and 2 WebKit (the same drag test and `fable-row-diff.spec.js:111` phone layout). U2 to U6 and D1 to D4 follow; merge at each milestone the notes mark done.
2. Merge Writer (`fable-writer`, last seen `8dc0644`): the second pack's zip, W2 to W6. Merge with `--no-ff`.
3. Merge Scope (`fable-scope`, last seen `1ab7281`): S3 to S5. Merge with `git merge --squash origin/fable-scope`, so the F3-08 and F3-09 commits (everything up to `a73dd99` on that branch) stay out of `fable` history. After the squash, `git status` shows only the new files; that is the check.
4. For each merge, before committing: ownership check on the commits (`node scripts/check-ownership.mjs who $(git log --no-merges --name-only --format= fable..origin/<branch> | sort -u)`); a file outside the lane goes back to its owner. Then lint, unit tests, `node scripts/build-manifest.mjs` when anything under `src/` or `styles/` changed, commit the manifest, `git fetch`, `git push origin fable`. Never rebase over a merge commit.
5. Apply what the notes ask of the integrator: strings (`src/ui/strings.js`), `src/app/**` calls, `src/batch/execute/index.js` lines. Scope's S5 and Writer's W5 carry the final lists. Check the open string items: `scope.pattern` and `scope.needsInspect` have no `{detail}` placeholder; the flag `output.nameTaken` has no place where it is shown.
6. CI loop: `gh run list --branch fable`; read the `browsers` summary (`##[notice]## firefox: ...`), route each failing test to the lane that owns its file (`check-ownership who`). A browsers run can be started on any branch with `workflow_dispatch` and the `spec` input.
7. When D3 (`FINAL-GATE.md`) is on `fable`, check every row against the repo and write the verdict in `PROGRESS.md`. The check is better done by something that did not write the code.
8. The only item that needs a person: the Excel sitting with Writer's kit. When `RESULTS.csv` comes back, run `node scripts/read-excel-results.mjs <file>` and apply the text it prints to `docs/observations.md`, the README line and `FINAL-GATE.md`.

Persistent rules for the integrator:

- No code comments. No new branches. `beta` and `main` are not touched. Short commit-message style summaries. Commit trailers as in `OWNERSHIP.md` rule 5.
- The sub-agent tool is not used for lane work: the user's own three sessions are the real workers, and extra agents drain the shared usage limit and fail with HTTP 429.
- A GitHub token is never written anywhere. If the session has no access to the repo, ask for it to be attached (`add_repo`, push access) and clone from there.
- Do not decide what the plan or `DECIDED.md` already decides; decide what the plan answers, record it in `DECIDED.md`, and tell the user in one line. Questions the plan does not answer and that change what the product does go to the user.
- Keep every agent busy: when a lane's list runs out, give it the next package from `ROADMAP.md` (a bigger job with real milestones), not a wait.

Running things in a fresh container:

- Clone and install: the repo is `datakid/Quoin`; run `npm install` in the clone. Lint `node tests/lint/run.js`; unit `node --test tests/unit/*.test.js`. Baseline: 1925 tests, 1919 pass, 0 fail, 5 skipped. `T-WB-05` and `T-WB-09` are flaky timing tests and are not chased.
- Chromium specs: a Playwright config with `testDir` `tests`, `testMatch` `e2e/**/*.spec.js` and `a11y/**/*.spec.js`, `workers: 1`, `timeout: 60000`, `snapshotPathTemplate: '{testDir}/__visual__/{arg}{ext}'`, `baseURL` `http://localhost:<port>`, the pre-installed Chromium as `executablePath` with `--no-sandbox`, and `webServer` `node tests/e2e/server.js` with `PORT=<port>`. Keep it outside the repo. A spec that hardcodes port 5173 (`privacy.spec.js` T-PRIV-1) fails on any other port; that is not a defect.
- Firefox and WebKit run only in CI (`.github/workflows/browsers.yml`).
