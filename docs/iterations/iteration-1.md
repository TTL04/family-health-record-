# Iteration 1 — "Make it visible"

**Dates:** 2026-11-06 → 2026-11-25
**Goal (plan §7.2):** a stranger can put one report into the system within two minutes, and the record is still there after the app is restarted.
**Selected backlog:** US-01 to US-08 (all eight Must items).

## What the iteration produced

| US | Acceptance criterion | Status | Evidence |
|---|---|---|---|
| US-07 | Open one report and read every value, with reference range and in/out-of-range flag | **Merged 11-06** | issue #1 · PR #2 · `873a3cb` · 6 tests |
| US-01 | Create a patient profile; an empty required field blocks saving | **Merged 11-25** | PR #17 · `client/profile.html` |
| US-02 | Upload a 2 MB JPG in under 3 s; oversized or unsupported files rejected with a reason | **Merged 11-25** | PR #17 · `test/photo.test.mjs` |
| US-03 | Extraction returns name, value, unit and date in 5 s | **Merged 11-25** | PR #17 · `lib/llm.mjs` |
| US-04 | A corrected value persists and is tagged as user-corrected | **Merged 11-25** | PR #17 · `normalizeItem` |
| US-05 | A blurred or skewed photo is blocked with a retake prompt | **Merged 11-25** | PR #17 · `lib/photo.mjs` |
| US-06 | 12 reports listed newest first, loading in under 2 s | **Merged 11-25** | PR #17 · `client/index.html` |
| US-08 | The same records appear in the same order after a restart | **Merged 11-25** | PR #17 · `lib/store.mjs` · `test/store.test.mjs` |

Not started: US-09 to US-13 (Should/Could). Test suite at the end of the iteration: **24 passing**, raised to **26** by the two tests added when review found the photo limit was wrong.

> The 11-25 batch is PR #17, merged as `a2af016`. Review of that pull request found the photo limit set to 10 MB while US-02 asks for 2 MB; `0f05623` fixes it and `0daefb7` pins both range boundaries. That finding is the only defect the process caught before release, and it arrived in the last hour of the iteration.

## How the work was done

`issue → feat/* branch → commits → pull request (what / why / how to verify) → review → merge`, with `Closes #n` in the body. Review was governed by the rule added in `CONTRIBUTING.md`: one specific observation plus one question, because our first two reviews were the single word "good".

## Problems observed — with numbers

1. **No automated check existed.** The repository had no `.github/workflows` at all. CI runs in this iteration: **0**.
2. **One commit block carried the whole iteration.** About 900 lines across five client pages and a rewritten `server.mjs` sat uncommitted in the working copy, so none of it was traceable until it was split. Traceable share of iteration 1 output: **1 of 8 user stories**.
3. **A requirement hid inside another requirement's acceptance criterion.** US-09 promises one indicator plotted "in a single unit". That phrase presupposes unit normalisation, but no backlog item, issue or test owns it. Result: the code compares raw numbers and the assumption is written nowhere. Confirmed by inspection — `lib/logic.mjs` `isAbnormal` compares `item.value` against the reference bounds and never looks at `item.unit`.

Problem 3 is the one we chose to fix in iteration 2. Problems 1 and 2 are fixed as infrastructure: a workflow file, and one branch per theme.

## Retrospective

**Went well**
- Writing acceptance criteria before code. US-07's four criteria mapped one-to-one onto six tests, so the tests were never invented afterwards.
- The review rule changed behaviour measurably: PR #15 drew a 596-character review, PR #16 a 487-character one.

**Did not go well**
- We tested a control by assuming it worked. The ruleset saved cleanly on a private repository and enforced nothing; we found out by pushing directly to `main`.
- Work was produced faster than it was recorded. Eight user stories ended up in one working-copy change rather than eight traceable changes.

**One change for iteration 2**
> Every hidden precondition inside an acceptance criterion becomes its own tracked technical task with its own test.

## Metrics

The plan defined four product metrics (10 s lookup, ≥85% extraction accuracy, 3 s upload, 2 s timeline) and **no collaboration metric**. Without one, a process improvement cannot be evaluated, so two are defined here and justified below.

| Metric | How it is measured | Iteration 1 baseline |
|---|---|---|
| Hidden preconditions tracked as issues | count of preconditions named in an AC that have their own issue | **0 of 3** (units, time zone, pagination) |
| Defects caught before merge | count of failing tests that changed the design before merging | **0** |

Both are counted the same way in iteration 2, so the comparison stays honest.
