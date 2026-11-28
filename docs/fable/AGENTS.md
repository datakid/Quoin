# Agents: who is who, where each plan is, how to pick up

Written 2026-11-28 by the integrator. This is the first file a new chat reads. It is kept current at every merge. If it disagrees with an older handover file, this file wins.

Repo: `datakid/Quoin` (renamed from `power-query-manager`; GitHub redirects the old name). Trunk is branch `fable`. `beta` and `main` are never touched. No new branches. A token is never written into a file, a commit or memory; if a push needs access, ask the user to attach the repo to the session.

## The four agents

| Agent | Branch | Lanes | The plan (brief) | State (notes) | History only |
|---|---|---|---|---|---|
| Integrator (Claude on `fable`) | `fable` | everything not listed for a lane | `docs/fable/ROADMAP.md`, `docs/fable/DECIDED.md`, `docs/fable/MANAGER.md` section 6, `docs/fable/OWNERSHIP.md` | the status table below, `docs/fable/PROGRESS.md` | `docs/fable/HANDOVER.md` |
| Trunk agent | `fable-trunk-handover` | `harness` (finished), `ui`, `docs` | `docs/fable/lanes/ui.md` (U1 to U6), then `docs/fable/lanes/docs.md` (D1 to D4) | `docs/fable/lanes/NOTES-ui.md`, `NOTES-docs.md`, `NOTES-harness.md` | `docs/fable/handover/HANDOVER.md`, `MESSAGES-trunk.md` |
| Writer | `fable-writer` | `writer` | `docs/fable/lanes/writer.md` (W1 to W5) | `docs/fable/lanes/NOTES-writer.md`, `PROGRESS-writer.md`, `MESSAGES-writer.md` | `docs/fable/HANDOVER-writer.md` |
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
- Writer: `Continue quoin as Writer (branch fable-writer). Read docs/fable/AGENTS.md, docs/fable/lanes/writer.md and the State block of docs/fable/lanes/NOTES-writer.md. Merge origin/fable, continue at the first milestone not done (W1 to W5), push after each milestone, do not wait for me.`
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

Updated by the integrator at each merge. As of `fable` `88c2764` (2026-11-28).

| Agent | Done and merged | In progress or next | Waiting on |
|---|---|---|---|
| Integrator | merges of Writer `eb9c403`, Scope `2c9d212` (squashed, F3-08 and F3-09 history kept out), trunk harness `00c322c`; strings for Scope's codes; closing run message; Open XML check fix; ownership, roadmap, decisions, this file | merge trunk's UI work when U1 finishes; CI loop; I4 check of `FINAL-GATE.md` | trunk U1, D3 |
| Trunk agent | harness lane (browsers CI summary, skip helpers, specs; `NOTES-harness.md`) | U1: probe commit `bc5d5c9` on its branch ("temporary, removed next"); then U2 to U6, then D1 to D4 | nothing |
| Writer | queue items 1 to 5 (pack split, check audit, corpus tests, one-page Excel README) | W1 to W5 in `lanes/writer.md`; item "review of Scope's S1" is unblocked now that S1 is on `fable` | nothing |
| Scope | S1 (`940a3b8`: sheet-write trust gate, numFmts refusal fixed, UTF-16 sheet names) | S2 to S5 in `lanes/scope.md` | nothing |

Needs a person, and blocks no agent: the Excel sitting with Writer's kit (`DECIDED.md` item 5). Everything else the user used to be asked is decided in `DECIDED.md`.
