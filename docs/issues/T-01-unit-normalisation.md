# T-01 Normalise laboratory units before any comparison

> Paste this file into a new GitHub issue titled
> **`T-01: normalise laboratory units before comparison`**
> Labels: `technical-task`, `iteration-2`

## Context

US-09 asks for one indicator plotted across dates **in a single unit**. That promise is not currently kept: `unit` is carried through the system as an unvalidated string and is never used in any calculation.

This task exists because the precondition was hidden inside another requirement's acceptance criterion, where no issue and no test could see it. Making it a tracked task is the iteration 2 process improvement.

## Problem, with evidence

| Where | What it does |
|---|---|
| `server.mjs:137` | `let unit = String(raw?.unit \|\| '').trim()` — whatever arrives is kept |
| `server.mjs:150` | `unit = unit \|\| builtin.unit` — the built-in unit is only a fallback for *empty*, never a correction for *wrong* |
| `lib/logic.mjs:64–68` | `isAbnormal` compares `item.value` against `refLow`/`refHigh`; the unit is not consulted |
| `lib/logic.mjs:113` | the change since last time is `(item.value - prev.value) / \|prev.value\|` — a percentage computed across two possibly different units |
| `test/logic.test.mjs:13` | every fixture uses the built-in unit, so no test can expose the gap |

Consequence: a haemoglobin result of `11.8 g/dL` is compared against a `115–175 g/L` range and reported as **low**. No error is raised; the system returns a confident wrong answer.

## Scope

- One conversion module, table-driven, one table entry per indicator (the factor differs by substance, so a single global convert function is wrong).
- Convert once, at the boundary where data enters. Nothing downstream converts again.
- Store the converted value **and** the original string.
- Reject units that are not in the table, listing the accepted ones.

## Acceptance criteria

| # | Given | Then |
|---|---|---|
| **AC1** | HGB entered as `11.8 g/dL` | stored as `118 g/L` and reported **normal**, not low |
| **AC2** | GLU entered as `99 mg/dL` | stored as `5.49 mmol/L` (±0.02) and reported normal |
| **AC3** | the same unit written as `10⁹/L`, `10^9/L`, `10^9/l`, `×10^9/L` | all normalise to one stored form, and all four give the same verdict |
| **AC4** | a unit not in the table, e.g. `foo` | the entry is rejected with the accepted units listed; nothing is stored and no verdict is produced |

## Out of scope

- Converting units in the browser for display. That would convert twice and is the bug this task prevents.
- Any indicator without a published conversion factor.
- Retro-fitting stored records. There are none outside fixtures.

## How to verify

```bash
npm test
```

Expected: the seven `T-01` tests pass, together with the existing 26. To see the failure first, check out the commit that adds `test/units.test.mjs` before the implementation lands — all seven fail with `ERR_MODULE_NOT_FOUND` until `lib/units.mjs` exists.

## Traceability

| Requirement | Issue | Change | Test |
|---|---|---|---|
| US-09 ("in a single unit") | this issue | `lib/units.mjs`, wired into `normalizeItem` | `test/units.test.mjs` — 7 tests |

Three of the seven tests guard behaviour the criteria do not spell out, because each one is a way the obvious implementation goes wrong:

- converting an already-canonical value a second time (118 g/L becoming 1180 g/L);
- one global factor for every indicator, which is wrong for whichever substance it was not derived from;
- converting the reading but not the reference range printed beside it, which compares 118 g/L against a bound of 16 g/dL and calls every result high.

