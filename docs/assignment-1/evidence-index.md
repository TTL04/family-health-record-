# Assignment 1 — Evidence Index

Everything an assessor needs to verify the Assignment 1 submission without reading the report first. The report makes the argument; this page points at the artefacts.

- **Repository:** https://github.com/TTL04/family-health-record-
- **Visibility:** public, no invitation required
- **Submission tag:** `a1-submission` (see [Tags](../../tags))
- **Team:** Tang Tongle (Tim) 25305393 · Zhang Shengxin (Thomas) 25306038 · Zhao Wenjun (Roy) 25305761 · Li Siyou (Alan) 25306036

---

## 1. Required evidence

The brief asks for four links: the backlog, one tracked requirement, one reviewed change, and test results.

| Required | Where it is |
|---|---|
| **Project backlog** | 13 issues, each with testable acceptance criteria, labelled `must` / `should` / `could` and `iteration-1` / `iteration-2`. See [Issues](../../issues?q=is%3Aissue) and the table in §2. |
| **Tracked requirement** | [Issue #1 — US-07 Open one report and read all its values](https://github.com/TTL04/family-health-record-/issues/1). Closed 2026-11-06. Verification recorded in [a comment on the issue](https://github.com/TTL04/family-health-record-/issues/1#issuecomment-6793670392) rather than by editing the description. |
| **Reviewed change** | [PR #2 — feat: add report detail view with abnormal flags (US-07)](https://github.com/TTL04/family-health-record-/pull/2). Three-section body (what / why / how to verify), `Closes #1`, merged as `873a3cb`. |
| **Test results** | `npm test` → 6 tests, 6 pass, 0 fail. Reproduced on Node v22.22.2 on 2026-11-11. Command and expected output are in the [README](../../README.md#run-the-tests). |

---

## 2. Backlog

Thirteen items. Priority follows MoSCoW: eight Must, three Should, two Could. Acceptance criteria are written so that each one either passes or fails without discussion.

| ID | User story | Priority | Iteration | Issue |
|---|---|---|---|---|
| US-01 | Create a patient profile | Must | 1 | [#3](../../issues/3) |
| US-02 | Upload a photo or PDF | Must | 1 | [#4](../../issues/4) |
| US-03 | Have the report read automatically | Must | 1 | [#5](../../issues/5) |
| US-04 | Correct a value before saving | Must | 1 | [#6](../../issues/6) |
| US-05 | Reject poor photos | Must | 1 | [#7](../../issues/7) |
| US-06 | See one timeline | Must | 1 | [#8](../../issues/8) |
| US-07 | Open one report and read all its values | Must | 1 | [#1](../../issues/1) — **closed** |
| US-08 | Have the timeline survive an app restart | Must | 1 | [#9](../../issues/9) |
| US-09 | See one indicator across dates | Should | 2 | [#10](../../issues/10) |
| US-10 | Read a plain-language explanation | Should | 2 | [#11](../../issues/11) |
| US-11 | Delete a wrong upload | Should | 2 | [#12](../../issues/12) |
| US-12 | Invite a relative by code | Could | 2 | [#13](../../issues/13) |
| US-13 | Keep a second patient profile | Could | 2 | [#14](../../issues/14) |

US-07 carries issue number 1 because it was opened first, before the rest of the backlog was tracked. Items are referenced by ID, not by issue number.

**Out of scope:** diagnosis, treatment or prescription advice, appointment booking, hospital information system integration, and any promise of fully automatic recognition.

---

## 3. The workflow trial, step by step

| Step | What happened | What it demonstrates |
|---|---|---|
| 1 | Issue #1 opened with four checkable criteria, milestone `Iteration 1` | The requirement exists before the code, and it is decidable |
| 2 | Branch `feat/us-07-report-detail` cut from `main` | `main` was never written to directly |
| 3 | 5 files, +225 lines: detail view, range logic, 6 tests, `package.json`, README | The change matches the requirement |
| 4 | `npm test` → 6 of 6 pass, including a boundary case (9.5 against a 3.5–9.5 range is normal) | Automated check, not a claim |
| 5 | PR #2 opened with what / why / how to verify | A reviewer can reproduce without asking |
| 6 | Two approvals recorded, both reading only "good" | Independent review happened; it produced no content |
| 7 | Merged by the repository owner at 06:49 as `873a3cb` | The protected-branch flow was followed |
| 8 | Issue #1 closed automatically on merge | Requirement and change are traceable |

**On step 6.** The first approval arrived at 06:47, before the merge; the second at 07:01, twelve minutes after it. Only the first could have influenced the change. Both bodies were the single word "good". This is the trial's most useful finding and the reason the team now requires one specific observation and one question per review — see [`CONTRIBUTING.md`](../../CONTRIBUTING.md).

---

## 4. Branch protection, as actually configured

Read back from the GitHub API on 2026-11-11 (ruleset `main-protection`, id 26675267):

| Setting | Value |
|---|---|
| Enforcement | `active`, target `refs/heads/main` |
| Required approving reviews | 1 |
| Bypass list | empty |
| Non-fast-forward (force push) | blocked |
| Branch deletion | blocked |
| Dismiss stale approvals on push | enabled |
| Require conversation resolution | enabled |

The configuration and the report's description agree item for item.

---

## 5. Known limitations of this increment

Stated plainly, because Assignment 2 will build on them.

1. **Two of four US-07 criteria have no automated test.** Opening a row and opening the original file are verified by hand. Converting them into checks is planned for Iteration 1.
2. **The detail view renders a fixed fixture.** There is no database, no upload path and no OCR yet, so the increment runs without any of the archive plumbing.
3. **The prototype is not this increment.** [`prototype/family-health-record-prototype.html`](../../prototype/family-health-record-prototype.html) is a high-fidelity click-through used to agree the flow before any code was written. It stores nothing and its records disappear on refresh. The runnable increment is what `npm test` covers.
4. **No authentication exists yet.** Nothing in this increment is safe to point at real patient data, and none was used.

---

## 6. Other artefacts

| Artefact | Where |
|---|---|
| System overview diagram | [`docs/figures/figure1-system-overview.png`](../figures/figure1-system-overview.png) |
| Setup and test instructions | [README](../../README.md) |
| Click-through prototype | [`prototype/family-health-record-prototype.html`](../../prototype/family-health-record-prototype.html) |
| Collaboration rules | [`CONTRIBUTING.md`](../../CONTRIBUTING.md) — added by a separate pull request |
