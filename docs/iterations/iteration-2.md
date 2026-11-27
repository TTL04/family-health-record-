# Iteration 2 — "Make it understood"

**Dates:** 2026-11-26 → 2026-12-02
**Goal (plan §7.2):** a family member reads the explanation and can say what an abnormal value means.
**Selected backlog:** T-01 (technical task), US-09, US-10 if time allows.

## Why T-01 comes first

US-09 reads: *"Two or more reports plot one point per date **in a single unit**."*

That clause cannot be satisfied while `unit` is a free string. The current code stores whatever arrives and compares raw numbers, so `11.8 g/dL` and `118 g/L` are treated as different values and `11.8` is flagged low against a `g/L` range. The precondition was never tracked, so it was never built.

T-01 turns that precondition into a tracked task with its own tests. This is the one process improvement of the iteration, applied to the exact failure the retrospective named.

## Scope

| Item | Type | Acceptance |
|---|---|---|
| **T-01 Unit normalisation** | technical task | 4 criteria in the issue, 7 tests |
| US-09 One indicator across dates | Should | one point per date, single unit, reference limit dashed |
| US-10 Plain-language explanation | Should | ≤120 words, states the change since last time, disclaimer always shown |
| US-12 / US-13 invite and second profile | Could | **dropped** — no time, and sharing is not needed to prove the two pain points |

Dropped items are recorded here rather than silently omitted: the plan said "cut the Coulds, never cut a Must".

## Exit criteria

1. `npm test` passes, and the suite includes the four T-01 criteria.
2. A report entered with `g/dL` produces the same verdict as the same value entered in `g/L`.
3. CI is green on the pull request and has run at least six times during the iteration.
4. `README.md` describes the code that actually exists — the current one still documents a file that has been deleted.

## Improvement applied

> Every hidden precondition inside an acceptance criterion becomes its own tracked technical task with its own test.

Applied as: T-01 opened before any code; failing test committed first; implementation after.

## Metrics — target

| Metric | Iteration 1 | Iteration 2 target | Result |
|---|---|---|---|
| Hidden preconditions tracked as issues | 0 of 3 | 3 of 3 | **1 of 3** |
| Defects caught before merge | 0 | ≥ 1 | **0 of 1 PR** |
| CI runs | 0 | ≥ 6 | **1** |
| Substantive reviews per pull request | 0.7 (2 of 3) | ≥ 2 | **0 of 1 PR** |

The work volumes are not equal — iteration 2 is roughly half the code of iteration 1 — so the comparison is of *practice*, not of output. That difference is stated in the report rather than hidden.

## What actually happened

### Exit criteria

| # | Criterion | Result |
|---|---|---|
| 1 | `npm test` passes and includes the T-01 criteria | **Met** — 33 passing, 7 of them T-01 |
| 2 | `g/dL` produces the same verdict as the same value in `g/L` | **Met** — HGB `11.8 g/dL` stores as `118 g/L` and reads normal against 115–175; before the change the same input read *low* |
| 3 | CI green on the pull request, and has run at least six times | **Half met** — green in 10 s on PR #20, the first CI run in the repository's history; one run, not six |
| 4 | `README.md` describes the code that actually exists | **Met** — rewritten; it still documented `client/report-detail.*`, deleted in `8a27e72` |

### The change

`ebb142f` (red) → `3140720` (green) → `82013bb` (wired in) → `b6d28f5` (docs). The failing commit is on `main` and sits in the history next to the commit that makes it pass, which is the only reason the red step can be checked rather than claimed.

Four of the seven tests guard failure modes the acceptance criteria do not mention, and each one is a way the obvious implementation is wrong:

1. converting an already-canonical value a second time — 118 g/L becoming 1180 g/L;
2. one global factor for every indicator — right for glucose, wrong for cholesterol by a factor of two;
3. converting the reading but not the range printed beside it — 118 g/L compared against a bound of 16 g/dL, so every result reads high;
4. rejecting an entry that states no unit at all, which would have broken manual entry for any indicator outside the table.

The criteria named the behaviour; they did not name the ways it breaks. Writing the criteria down as executable assertions is what surfaced those three.

### Where the practice did not improve

The honest numbers are worse than the targets, and the reason is the same in both cases: **there was one pull request, and its review was the single word "good"**.

- **CI runs: 1, not 6.** The target assumed a series of small pull requests through the iteration. The iteration produced one, so the denominator never existed.
- **Substantive reviews: 0 of 1, against 0.7 in iteration 1.** The rule in `CONTRIBUTING.md` — one specific observation and one question — worked on PR #17, where the review found a real defect (the photo limit said 10 MB while US-02 says 2 MB). One PR later the same reviewer approved with no content. A rule that depends on the reviewer remembering it is not a rule; the next iteration should put the two prompts in the pull request template, where they are read at the moment of writing rather than remembered from a document.
- **Hidden preconditions tracked: 1 of 3.** T-01 was opened properly, with evidence and four acceptance criteria. The other two — the photo limit and the boundary behaviour — were found in review and fixed inline in PR #17, which means they were fixed without ever being written down. Fixing something is not the same as making it visible, and the second is what this iteration claimed to be about.

### What the defect was worth

Before T-01, `11.8` and `118` were the same number as far as the code was concerned, because the unit was never read. After it, `11.8 g/dL` cannot enter the system without becoming `118 g/L`, and `118 g/L` cannot enter it twice-converted. The failure mode did not get rarer; it became unrepresentable at the boundary.

That is the one thing this iteration can claim to have changed.


## Risks

| Risk | Response |
|---|---|
| Conversion table wrong for an indicator | Every factor asserted by a test with a known published value |
| Unknown unit rejected too aggressively | Rejection lists the accepted units, so the user can correct in one step |
| US-10 spills past the deadline | US-10 is last; the iteration is complete without it |
| Demo depends on a live network | The demo runs on pre-seeded local data |
