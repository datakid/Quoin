# Roadmap: what is left, who does it, in what order

Written 2026-11-27 by the integrator. One owner per milestone. A milestone is blocked only by what its row says; everything else runs now. When a lane finishes its milestones it writes `HAND BACK <hash>` in its notes and the integrator gives it the next package from the end of this file or says there is none and why.

## Left to do, from the plan

| Plan item | State | Milestones that close it |
|---|---|---|
| F5-01 Firefox and WebKit | after the harness lane: Firefox 4 failures, WebKit 2 (one flaky), all in ui lane files | U1 |
| F3 gate (F3-11) | needs the sheet-write check and three decisions of the user | S1, then the user |
| F5-04 real Excel closure | the person has not yet run the packs in one sitting | W1, then the user |
| F5-05 README and decisions | partly done | S5, W5, D1, D2 |
| F5-06 final gate | not started | D3, I4 |
| Not in the plan, found on the way | sheet names cut by code points, undeclared parts in sheet writes, hostile-input behaviour of the readers, writer behaviour over random sequences | S1, S3, W2, W3 |

## Lanes and milestones

| Owner | Milestone | Deliverable | Needs |
|---|---|---|---|
| scope | S1 | sheet-write trust gate: declared insertions, `<numFmts>` fix, UTF-16 sheet names, nine probes as tests | nothing |
| scope | S2 | Transform outputs over the whole fixture corpus, three modes | nothing |
| scope | S3 | resolve properties, 500 seeded recipes | nothing |
| scope | S4 | 300 workbooks, 1,200 units, stop in the middle | nothing |
| scope | S5 | decisions text, strings table, requests to other owners | S1 to S4 |
| writer | W1 | Excel sitting kit: one zip, one checklist, `RESULTS.csv`, a reader that drafts the observations text | nothing |
| writer | W2 | writer sequences, randomized, 300 cases | nothing |
| writer | W3 | hostile inputs for the compound-file and query readers | nothing |
| writer | W4 | review of Scope's S1 against the nine probes | S1 on `fable` |
| writer | W5 | table of checks and tests, requests to other owners | W1 to W4 |
| writer | W6 | browser specs for query remove and rename, module replace, replace in code with a pathological regex, align (plan F2-04 to F2-09) | nothing |
| trunk agent | harness lane | done: CI summary, flake audit, skip helper, test-side fixes (merged `00c322c`) | done |
| trunk agent | U1 | Firefox and WebKit to zero failures in a whole-suite `browsers.yml` run | nothing |
| trunk agent | U2 | the Preview stall at 2,000 files profiled, fixed, before and after in `performance.md` | nothing |
| trunk agent | U3 | phone and tablet audit at 320, 375 and 768 px with assertions | nothing |
| trunk agent | U4 | forced colours and dark, with a spec case | nothing |
| trunk agent | U5 | grid keyboard completeness with tests | nothing |
| trunk agent | U6 | hide `unchanged` rows by default with a count and a toggle (user decision D2), strings already in place | nothing |
| trunk agent | D1 | README checked claim by claim against code and tests | nothing |
| trunk agent | D2 | `docs/decisions.md`: every deviation, decision and Blocked item | S5, W5 for their text; starts without them |
| trunk agent | D3 | `FINAL-GATE.md`: sections 9 and 10 row by row with evidence | nothing |
| trunk agent | D4 | prepared replacement text for the Excel sitting outcomes | W1 for the case list |
| integrator | I1 | strings for Scope's codes, the closing run message, strings for D2: done (`9c964a3` and after); the D2 grid work moved to the trunk agent as U6 | done |
| integrator | I3 | CI loop: push, read the `browsers` run, send each failure to its owner | lanes pushing |
| integrator | I2 | merge each push, regenerate the manifest, strings for new codes from the notes | lanes pushing |
| integrator | I4 | check `FINAL-GATE.md` rows against the repo; the check is read by someone who did not write the code | D3 and everything above |

## Decided, and what still needs a person

All four questions that were listed here as waiting on the user are decided in `DECIDED.md` from the plan and the user's earlier answers: the 15-line report is right, the three F3-10 differences are closed, there is no recipe editor in Fable, and F3-08 and F3-09 stay held until the in-place Excel case passes.

Needs a person and blocks no agent: the Excel sitting with the kit from W1. Its rows in `FINAL-GATE.md` are marked `user` until `RESULTS.csv` comes back.

## Next packages, ready when a lane finishes

- scope: output formats for the combined workbook (freeze panes, widths, header style) with tests, only if the user wants them; otherwise help harness on the Safari offline question by reading how the service worker caches.
- writer: password-protected macro project fixture and its refusal path; signature removal corner cases.
- trunk agent: the visual baselines for each new surface in Firefox and WebKit, once the whole-suite browsers run is green (CI regenerates them; the agent reviews the images).
