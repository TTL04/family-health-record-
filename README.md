# Family Health Record

A mobile app that keeps, organises and explains the medical reports of an elderly family member.

A family photographs a lab report, the system extracts the measured values, files them by date and test item into one timeline, and a language model explains each value in plain language.

**This project does not diagnose, prescribe, or give treatment advice.** It stores and explains, and every explanation carries a disclaimer.

---

## Current state

Assignment 1 (planning and workflow trial) is complete. One backlog item is implemented — **US-07, open one report and read all its values**.

| Item | State |
|---|---|
| US-01 to US-06 (profile, upload, extraction, correction, quality check, timeline) | Not started |
| **US-07 — report detail view** | **Implemented and tested** |
| US-08 to US-13 | Not started |

The detail view renders against a fixed sample report, so it runs without a database, an OCR engine or a network connection.

---

## Requirements

- **Node.js 18 or later** (`node --test` requires 18+)
- No other dependencies — the implementation is plain ES modules with no runtime libraries

## Setup

```bash
git clone https://github.com/TTL04/family-health-record-.git
cd family-health-record-
```

`npm install` is not required: `package.json` declares no dependencies. Running it is harmless.

## Run the tests

```bash
npm test
```

This runs `node --test client/*.test.mjs`. Expected result — **6 tests, all passing**:

| Test | Asserts |
|---|---|
| `US-07 a value above the upper limit is abnormal` | WBC 11.2 against 3.5–9.5 → abnormal, direction `high` |
| `US-07 a value below the lower limit is abnormal` | PLT 96 against 125–350 → abnormal, direction `low` |
| `US-07 a value inside the range is not abnormal` | RBC 4.31 against 3.8–5.1 → normal |
| `US-07 a value exactly on a limit counts as normal` | 9.5 against a 3.5–9.5 range → normal (the boundary is inclusive) |
| `US-07 reference range is rendered as low - high` | Range string renders as `3.5 - 9.5` |
| `US-07 the abnormal count matches the flags on screen` | The count of flagged items equals 3 |

Node prints each test as `✔` followed by its name, then a summary reading `pass 6` and `fail 0`. The exact formatting varies slightly between Node 18, 20 and 22.

## View the detail screen

Open `client/report-detail.html` directly in a browser, or serve the folder:

```bash
npx serve client
```

WBC, PLT and NEUT% are marked **HIGH** or **LOW**; in-range values are left unmarked.

## Repository layout

```
.
├── client/
│   ├── report-detail.html        # US-07 detail screen
│   ├── report-detail.mjs         # REPORT fixture, isAbnormal, direction, referenceText, abnormalCount
│   └── report-detail.test.mjs    # 6 tests, one per acceptance criterion
├── .gitignore
├── README.md
└── package.json                  # test script only; no dependencies
```

---

## Collaborative workflow

- `main` is protected by the ruleset `main-protection`: one approving review required, no bypass list, force pushes blocked, stale approvals dismissed, conversation resolution required.
- Work happens on `feat/*` branches, one per issue.
- Every pull request states **what changed, why, and how to verify**, and closes its issue.
- Every review contains **one specific observation and one question**. An approval on its own is treated as an incomplete review.
- The test suite must pass before merge.

### Traceability

| Requirement | Issue | Change | Test |
|---|---|---|---|
| US-07 | [#1](https://github.com/TTL04/family-health-record-/issues/1) | [PR #2](https://github.com/TTL04/family-health-record-/pull/2) | `client/report-detail.test.mjs` — 6 tests |

The full backlog (13 items with acceptance criteria) and the evidence index are in `docs/assignment-1/`.

---

## Data and ethics

- No real patient data is stored in this repository. The report in `client/report-detail.mjs` is a synthetic fixture.
- In the planned implementation, uploaded files are stored encrypted outside the public directory and every read is authenticated.
- AI output is limited to explaining what a value means. It never diagnoses. Every panel shows: *For reference only. This is not medical advice.*
