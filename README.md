# Family Health Record

A web application that keeps, organises and explains the medical reports of an elderly family member, built for a family to share: one account owns the archive, and relatives join it with an invite code.

A family photographs a lab report, the system extracts the measured values, files them by date and test item into one timeline, and a language model explains each value in plain language. Every account sees only the records of the family it belongs to.

**This project does not diagnose, prescribe, or give treatment advice.** It stores and explains, and every explanation carries a disclaimer.

---

## Current state

Iterations 1 and 2 are complete. All thirteen backlog items (US-01 to US-13) are implemented, plus one technical task, **T-01 unit normalisation**, which iteration 2 added to fix a defect iteration 1 shipped.

| Item | State |
|---|---|
| US-01 to US-08 (profile, upload, extraction, correction, quality check, timeline, detail, persistence) | **Implemented and tested** |
| **T-01 — units normalised before comparison** | **Implemented and tested** |
| US-09 to US-13 (trend across dates, plain-language explanation, delete an upload, invite by code, second profile) | **Implemented and tested** |
| Session authentication, per-user data isolation, three-language interface (zh / en / both) | **Implemented and tested** |

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

Then open <http://localhost:3000>. The first screen is login — **register an account** with any username and password; this is a local deployment, nothing needs to be real. After signing in you land on the family dashboard. Data is written to `data/` and photos to `uploads/`; both are ignored by git.

- `PORT` overrides the port, `DATA_DIR` overrides the data directory.
- Extraction and explanation need `LLM_API_KEY`. Without it the app still runs — entry is manual and explanations are disabled. The UI says so rather than failing silently.

## Try the multi-user flow in two browsers

1. Register an account, create a patient, and add one report (manual entry is enough).
2. Open the admin console and copy the **bind code**.
3. In a second browser, register a second account and bind with that code. The invited member is **read-only**: an upload attempt is rejected by the server with 403, not merely hidden in the interface.
4. In the admin console, grant that member upload permission. The same upload now succeeds.

Unit normalisation along the way: enter haemoglobin as `11.8 g/dL` — it is stored as `118 g/L`, and the printed unit is preserved in `unitOriginal`.

## Run the tests

```bash
npm test
```

This runs `node --test`, which discovers every `test/*.test.mjs`. Expected result — **53 tests, all passing**:

| File | Tests | Covers |
|---|---|---|
| `test/logic.test.mjs` | 14 | Reference-range parsing, in/out-of-range verdicts, inclusive boundaries, abnormal count, sorting |
| `test/photo.test.mjs` | 7 | MIME and extension rules, the 2 MB limit from US-02, rejection reasons |
| `test/store.test.mjs` | 9 | Persistence across restart, patient upsert and validation, deletion, atomic writes, snapshot export/import |
| `test/report-types.test.mjs` | 3 | Report type categories, examples, readable guide |
| `test/units.test.mjs` | 7 | T-01: `g/dL` → `g/L`, `mg/dL` → `mmol/L`, four spellings of `10^9/L`, unknown units rejected |
| `test/auth.test.mjs` | 13 | Password hashing with salt, session lifecycle and expiry, bind codes, archive ownership isolation, invite binding |

Node prints each test as `✔` followed by its name, then a summary reading `pass 53` and `fail 0`. Exact formatting varies slightly between Node 18, 20 and 22.

CI runs the same suite on every pull request (`.github/workflows/tests.yml`).

## Units: converted once, at the boundary

`lib/units.mjs` holds one conversion table per indicator, because the factor belongs to the substance and not to the unit: 99 mg/dL of glucose is 5.50 mmol/L, while 99 mg/dL of cholesterol is 2.56 mmol/L.

`normalizeItem` in `server.mjs` calls it once, so everything stored is already in the canonical unit and `lib/logic.mjs` can keep comparing bare numbers. `lib/logic.mjs` deliberately imports nothing — it is served to the browser unchanged.

An entry that states a unit the table does not know is **rejected** with the accepted units listed. An entry that states no unit at all passes through untouched: it makes no claim that can be contradicted. Each entry also stores `unitOriginal` so the reason for the conversion stays traceable.

## Repository layout

```
.
├── client/                       # the browser side, plain ES modules
│   ├── login.html                # register, login
│   ├── index.html                # family dashboard (home after login)
│   ├── profile.html              # US-01 patient profile
│   ├── new.html                  # US-02/US-03 upload and extraction
│   ├── report.html               # US-04/US-07 one report, corrections, verdicts
│   ├── timeline.html             # US-06 timeline
│   ├── trend.html                # US-09 one indicator across dates
│   ├── bind.html                 # US-12 invite-code binding
│   ├── admin.html                # members, bind code, upload permissions
│   ├── settings.html             # language settings (zh / en / both)
│   ├── api.mjs                   # fetch wrapper shared by the pages
│   ├── i18n.mjs                  # three-language strings
│   ├── vendor/                   # vendored PDF.js (pdf.min.mjs, pdf.worker.min.mjs)
│   └── style.css
├── lib/
│   ├── auth.mjs                  # sessions, scrypt hashing, bind codes, permissions
│   ├── logic.mjs                 # reference ranges, verdicts, counts — no imports
│   ├── report-types.mjs          # report type abstraction
│   ├── units.mjs                 # T-01 conversion tables
│   ├── photo.mjs                 # US-02 photo validation
│   ├── store.mjs                 # US-08 JSON persistence, per-user scoping
│   └── llm.mjs                   # extraction and explanation
├── test/                         # acceptance tests, one file per area
├── server.mjs                    # HTTP API, session gate, static routes, entry normalisation
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
| US-09 to US-13, auth and isolation | [#10](https://github.com/TTL04/family-health-record-/issues/10) to [#14](https://github.com/TTL04/family-health-record-/issues/14) | [PR #22](https://github.com/TTL04/family-health-record-/pull/22) | `test/auth.test.mjs`, `test/report-types.test.mjs` |

The full backlog (13 items with acceptance criteria) and the evidence index are in `docs/assignment-1/`.

---

## Data and ethics

- No real patient data is stored in this repository. Every fixture is synthetic.
- Uploaded photos land in `uploads/`, which git ignores. Records fall back to `data/`, also ignored.
- Passwords are hashed with scrypt and a random salt; sessions are HttpOnly cookies. Permission checks are enforced server-side, not only in the interface.
- AI output is limited to explaining what a value means. It never diagnoses. Every panel shows: *For reference only. This is not medical advice.*
