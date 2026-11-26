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
| **T-01 Unit normalisation** | technical task | 4 criteria, see issue |
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
| Hidden preconditions tracked as issues | 0 of 3 | 3 of 3 | *fill in* |
| Defects caught before merge | 0 | ≥ 1 | *fill in* |
| CI runs | 0 | ≥ 6 | *fill in* |
| Substantive reviews per pull request | 0.7 (2 of 3) | ≥ 2 | *fill in* |

The work volumes are not equal — iteration 2 is roughly half the code of iteration 1 — so the comparison is of *practice*, not of output. That difference is stated in the report rather than hidden.

## Risks

| Risk | Response |
|---|---|
| Conversion table wrong for an indicator | Every factor asserted by a test with a known published value |
| Unknown unit rejected too aggressively | Rejection lists the accepted units, so the user can correct in one step |
| US-10 spills past the deadline | US-10 is last; the iteration is complete without it |
| Demo depends on a live network | The demo runs on pre-seeded local data |
