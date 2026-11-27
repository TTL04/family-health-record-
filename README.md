# Family Health Record

A mobile app that keeps, organises and explains the medical reports of an elderly family member.

A family photographs a lab report, the system extracts the measured values, files them by date and test item into one timeline, and a language model explains each value in plain language.

**This project does not diagnose, prescribe, or give treatment advice.** It stores and explains, and every explanation carries a disclaimer.

---

## Current state

Iterations 1 and 2 are complete. Eight backlog items (US-01 to US-08) are implemented, plus one technical task, **T-01 unit normalisation**, which iteration 2 added to fix a defect iteration 1 shipped.

| Item | State |
|---|---|
| US-01 to US-08 (profile, upload, extraction, correction, quality check, timeline, detail, persistence) | **Implemented and tested** |
| **T-01 — units normalised before comparison** | **Implemented and tested** |
| US-09 to US-13 (one indicator across dates, plain-language explanation, sharing) | Not started |
| US-10 plain-language explanation | Partly: `POST /api/explain` exists, no panel yet |

The app runs on a local Node server with a JSON file for storage. No database, no build step, no runtime dependencies.

---

## Requirements

- **Node.js 18 or later** (`node --test` requires 18+)
- No other dependencies — plain ES modules, no runtime libraries

## Setup

```bash
git clone https://github.com/TTL04/family-health-record-.git
cd family-health-record-
```

`npm install` is not required: `package.json` declares no dependencies. Running it is harmless.

## Run the app

```bash
npm start
```

Then open <http://localhost:3000>. Data is written to `data/` and photos to `uploads/`; both are ignored by git.

- `PORT` overrides the port, `DATA_DIR` overrides the data directory.
- Extraction and explanation need `LLM_API_KEY`. Without it the app still runs — entry is manual and explanations are disabled. The UI says so rather than failing silently.

## Run the tests

```bash
npm test
```

This runs `node --test`, which discovers every `test/*.test.mjs`. Expected result — **33 tests, all passing**:

| File | Tests | Covers |
|---|---|---|
| `test/logic.test.mjs` | 14 | Reference-range parsing, in/out-of-range verdicts, inclusive boundaries, abnormal count, sorting |
| `test/photo.test.mjs` | 7 | MIME and extension rules, the 2 MB limit from US-02, rejection reasons |
| `test/store.test.mjs` | 5 | Persistence across restart, ordering, deletion, patient handling |
| `test/units.test.mjs` | 7 | T-01: `g/dL` → `g/L`, `mg/dL` → `mmol/L`, four spellings of `10^9/L`, unknown units rejected |

Node prints each test as `✔` followed by its name, then a summary reading `pass 33` and `fail 0`. Exact formatting varies slightly between Node 18, 20 and 22.

CI runs the same suite on every pull request (`.github/workflows/tests.yml`).

## Units: converted once, at the boundary

`lib/units.mjs` holds one conversion table per indicator, because the factor belongs to the substance and not to the unit: 99 mg/dL of glucose is 5.50 mmol/L, while 99 mg/dL of cholesterol is 2.56 mmol/L.

`normalizeItem` in `server.mjs` calls it once, so everything stored is already in the canonical unit and `lib/logic.mjs` can keep comparing bare numbers. `lib/logic.mjs` deliberately imports nothing — it is served to the browser unchanged.

An entry that states a unit the table does not know is **rejected** with the accepted units listed. An entry that states no unit at all passes through untouched: it makes no claim that can be contradicted. Each entry also stores `unitOriginal` so the reason for the conversion stays traceable.

## Repository layout

```
.
├── client/                       # the browser side, plain ES modules
│   ├── index.html                # US-06 timeline
│   ├── profile.html              # US-01 patient profile
│   ├── new.html                  # US-02/US-03 upload and extraction
│   ├── report.html               # US-04/US-07 one report, corrections, verdicts
│   ├── api.mjs                   # fetch wrapper shared by the pages
│   └── style.css
├── lib/
│   ├── logic.mjs                 # reference ranges, verdicts, counts — no imports
│   ├── units.mjs                 # T-01 conversion tables
│   ├── photo.mjs                 # US-02 photo validation
│   ├── store.mjs                 # US-08 JSON persistence
│   └── llm.mjs                   # extraction and explanation
├── test/                         # acceptance tests, one file per area
├── server.mjs                    # HTTP API, static routes, entry normalisation
├── docs/
│   ├── assignment-1/             # plan, backlog, evidence index
│   ├── iterations/               # what each iteration planned and what happened
│   └── issues/                   # technical tasks that outgrew a comment
├── .github/workflows/tests.yml   # CI: npm test on every pull request
├── CONTRIBUTING.md
└── package.json
```

---

## Collaborative workflow

- `main` is protected by the ruleset `main-protection`: one approving review required, no bypass list, force pushes blocked, stale approvals dismissed, conversation resolution required.
- Work happens on `feat/*` branches, one per issue.
- Every pull request states **what changed, why, and how to verify**, and closes its issue.
- Every review contains **one specific observation and one question**. An approval on its own is treated as an incomplete review.
- The test suite must pass before merge. Merges are always merge commits, never squashes, so a failing-then-passing commit pair stays visible in the history.

### Traceability

| Requirement | Issue | Change | Test |
|---|---|---|---|
| US-01 to US-08 | [#2](https://github.com/TTL04/family-health-record-/issues/2) onward | [PR #17](https://github.com/TTL04/family-health-record-/pull/17) | `test/logic.test.mjs`, `photo`, `store` |
| US-07 detail view (iteration 0) | [#1](https://github.com/TTL04/family-health-record-/issues/1) | [PR #2](https://github.com/TTL04/family-health-record-/pull/2) | carried into `test/logic.test.mjs` |
| T-01 unit normalisation | [#19](https://github.com/TTL04/family-health-record-/issues/19) | [PR #20](https://github.com/TTL04/family-health-record-/pull/20) | `test/units.test.mjs` — 7 tests |

The full backlog (13 items with acceptance criteria) and the evidence index are in `docs/assignment-1/`.

---

## Data and ethics

- No real patient data is stored in this repository. Every fixture is synthetic.
- Uploaded photos land in `uploads/`, which git ignores. Records fall back to `data/`, also ignored.
- AI output is limited to explaining what a value means. It never diagnoses. Every panel shows: *For reference only. This is not medical advice.*
