---
title: "Retire LLM Judges - Plan"
date: 2026-09-03
type: feat
topic: retire-llm-judges
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
status: shipped
---

> **Shipped** (PR #40). Named leftover: eval-parse unit tests in [`docs/residual-review-findings/feature-retire-llm-judges.md`](../residual-review-findings/feature-retire-llm-judges.md) (GitHub #38).

# Retire LLM Judges - Plan

## Goal Capsule

- **Objective:** Remove LLM judges from the personal-tool product so tailor is a single curator pass and smoke is artifacts plus human review.
- **Product authority:** This Product Contract. `STRATEGY.md` is rewritten to match; historical judge plans are not active scope.
- **Open blockers:** None.
- **Stop conditions:** Re-introducing an on-path critique loop, smoke score gates, or a prompt-rewrite deliverable in this work.
- **Execution profile:** Code teardown with TDD on remaining smoke/tailor behavior; docs/strategy aligned in the same change.
- **Tail ownership:** Operator eyeballs smoke artifacts; later user feedback and Anthropic Batch are out of this plan.

---

## Product Contract

### Summary

Take LLM judges out of the personal-tool product. Tailor stays one curator call. Smoke still writes the CV artifacts the operator already reads; it no longer scores or hard-fails on grounding/JD-fit. Quality is an excellent single-pass prompt the operator keeps refining, judged by a human now and by real user feedback in a later product — not an LLM in the request loop. That also unlocks Batch later.

### Problem Frame

Two ideas collided: Anthropic Batch for cheaper tailor, and LLM-as-judge (on-path critique-revise plus smoke gates). Batch cannot cheaply chain draft → critique → revise. Smoke scores were not changing submit decisions; the operator already eyeballs `.docx` / JSON. Critique-revise is already off by default. STRATEGY still names a judge verdict as the pivot success signal, so the docs promise a quality loop the operator does not use.

### Key Decisions

- **Drop smoke judge gates.** `(session-settled: user-directed — chosen over keeping them as an offline quality gate: smoke scores never changed a submit; operator eyeballs artifacts)` Governs R2, R3, AE2.
- **Tear on-path critique-revise out of the product, not leave it dormant.** `(session-settled: user-directed — chosen over disable-and-keep-code: the loop is not a product feature for this finish line)` Governs R1, AE1.
- **Anthropic Batch is later.** `(session-settled: user-directed — chosen over Batch-now: drop judges first; Batch is a cost optimization on a judge-free sync path)` Governs R8.
- **Retire Judge coverage / live-API-judge milestone language / M6 / bakeoff for this finish line.** `(session-settled: user-directed — chosen over parking those tracks: this finish line is not a judge product)` Governs R4, R5.
- **This plan is teardown plus strategy rewrite, not a curator-prompt pass.** `(session-settled: user-directed — chosen over shipping a new prompt in this work: prompt craft stays an ongoing operator loop)` Governs R6, R7.
- **Modular smoke and flexible cover-letter DOCX stay.** `(session-settled: user-approved — chosen over folding those into this teardown: they are not judges)` Governs R2.

### Requirements

**Tailor product**

- R1. `POST /api/tailor-cv` produces curated JSON and `.docx` from a single curator model call. There is no on-path adversarial judge, no revise pass, and no env flag that can turn that loop back on.

**Smoke / operator path**

- R2. `npm run smoke` still hits a running server, asserts dual artifacts (and cover letter when flexible), and writes redact-by-default files. It does not call judge models.
- R3. Smoke success or failure does not depend on grounding or JD-fit scores. Health, tailor, schema, and docx failures still fail the run.

**Product story**

- R4. `STRATEGY.md` names human review of artifacts (and later user feedback) as the quality loop. It does not name a judge verdict or `scoreJsonGrounding` as the primary flexible success signal or honesty floor.
- R5. Operator docs (API, model selection, testing, concepts, file layout, walkthrough) no longer describe critique-revise or smoke judges as current behavior.
- R6. Standing quality strategy is: refine the single-pass curator prompt over time. This plan does not ship a new prompt.
- R7. A later multi-user product may gather user feedback to improve the product. That loop is not built here.

**Deferred unlock**

- R8. Native batch APIs remain deferred. This work must not add async poll infrastructure. Removing the in-loop judge is what keeps a future Batch path to one call per JD.

### Key Flows

- F1. Tailor request
  - **Trigger:** Authenticated `POST /api/tailor-cv` with a JD.
  - **Steps:** Load master → one curator call → schema/size → mechanical `.docx` → response.
  - **Outcome:** Dual artifacts. No judge or revise LLM call.
  - **Covered by:** R1.

- F2. Operator smoke
  - **Trigger:** `npm run smoke` against a running server.
  - **Steps:** Health → tailor → validate docx/schema → write artifacts → exit 0 if those pass.
  - **Outcome:** Operator reads the files. No judge scores, no score-based exit.
  - **Covered by:** R2, R3.

### Acceptance Examples

- AE1. Given `CRITIQUE_REVISE_ENABLED` unset or any former truthy value in the environment, tailor still makes one curator call and returns the first valid draft. **Covers R1.**
- AE2. Given a successful tailor response with valid docx and schema, smoke writes artifacts and exits 0 even if no judge model is configured. **Covers R2, R3.**
- AE3. Given tailor/schema/docx failure, smoke still fails at that stage. **Covers R3.**
- AE4. `STRATEGY.md` and operator docs describe human review, not smoke gates or critique-revise, as current quality behavior. **Covers R4, R5.**

### Success Criteria

- Tailor latency/cost is one curator call per request.
- Smoke no longer requires `EVAL_JUDGE_MODEL` (or successor judge env) to complete a passing artifact run.
- A cold reader of `STRATEGY.md` would not look for a live judge track.

### Scope Boundaries

**In scope**

- Remove on-path critique-revise from the tailor pipeline and delete its module/tests/env.
- Remove smoke JSON judges, gates, and judge-shaped result fields.
- Delete judge modules that have no remaining production caller.
- Rewrite STRATEGY and current-behavior operator docs.
- Mark the parked judge-model bakeoff plan as superseded by this work.

**Deferred for later**

- Anthropic Message Batches / DeepSeek batch (separate worker, not Next.js).
- User-feedback loop for a multi-user product.
- Curator prompt rewrite as a deliverable.
- Non-LLM smoke checklist or mechanical grounding allowlists.

**Outside this product's identity (this finish line)**

- LLM-as-judge as the submit/no-submit signal.
- Holistic “strong enough?” smoke judge.
- Judge-model bakeoff.

### Dependencies / Assumptions

- Schema validation and curated JSON size checks on tailor stay. They are not an honesty floor.
- `docs/plans/README.md` does not exist on `origin/main`; this branch updates `STRATEGY.md` as the live thesis. If a plans README is merged later, drop live-API-judge / M6 / bakeoff language there.
- Historical markdown eval scorers in `eval-judge.ts` have no production caller (`scripts/eval-cv.ts` is gone).

<!-- ce-section: work-relationships -->
### How This Work Fits Together

This plan owns **judge teardown and the quality-story rewrite**.

- Anthropic Batch — **Depends on** this teardown (one call per JD). **Can proceed independently** afterward. Not active scope.
- Curator prompt craft — **Shares** the single-pass quality thesis (R6). Ongoing operator work, not a unit here.
- Later user-feedback loop — **Enables** product-scale improvement once there are users. Not active scope.
- Modular smoke / flexible cover-letter DOCX — **Can proceed independently** of this teardown. Do not regress those paths.

### Sources / Research

- Grounding: `app/api/lib/tailor-pipeline.ts` (critique block ~434+), `app/api/lib/adversarial-judge.ts`, `app/api/lib/eval-judge.ts`, `app/api/lib/smoke-runner.ts`, `app/api/lib/smoke-helpers.ts`, `scripts/e2e-tailor-cv.ts`.
- `STRATEGY.md` lines 24–51 (judge verdict + Judge coverage track).
- `docs/arch/MODEL_SELECTION.md` (smoke judges; Batch deferred).
- `docs/arch/README.md` (do not build batch inside Next.js).
- Parked: `docs/plans/2026-07-30-001-feat-judge-model-bakeoff-plan.md`.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Delete the critique-revise branch from `tailor-pipeline.ts`; do not keep `CRITIQUE_REVISE_*` / `ADVERSARIAL_JUDGE_*` env.** Instantiates R1. `(session-settled: user-directed — chosen over leaving a dormant flag: no way to turn the loop back on)`
- KTD2. **Smoke library stops after schema/docx success.** Drop judge deps, `stage: "judges"`, gate fields on `VerifySmokeSuccess`, and CLI score logging / score-based `process.exit(1)`. Instantiates R2, R3.
- KTD3. **Delete `eval-judge.ts` and production-dead judge config once smoke/on-path no longer import it.** Includes JSON scorers and unused legacy markdown scorers. Remove `EVAL_JUDGE_MODEL` / `EVAL_JUDGE_MAP_JSON` / `SMOKE_GROUNDING_MIN` / `SMOKE_JD_FIT_MIN` / judge prompt env from `.env.example` and getters with no remaining caller. Instantiates R2, R5. Leave `eval-parse.ts` (tailor JSON extract). Delete `eval-schema.ts` / `eval-extract.ts` / `eval-defaults.ts` judge pieces only if they become unreferenced; do not keep zombie judge env.
- KTD4. **Do not add mechanical grounding allowlists or a smoke checklist.** Honesty is operator (later: user) review plus existing schema/size checks. Instantiates R4, deferred non-goals.
- KTD5. **Docs: rewrite current-behavior text; stamp the bakeoff plan superseded; do not rewrite completed historical implementation plans.** Instantiates R4, R5.

### Assumptions

- `getEvalJudgeModel` / `getJudgeMap` exist only for judges; removing them is in scope when callers die.
- Flexible cover letter on the tailor response and smoke DOCX write stay.

### Sequencing

U1 (on-path) and U2 (smoke) can proceed in either order. U3 (delete unused modules/env) after both. U4 (STRATEGY/docs) after the behavior is real so docs match code. Prefer U1 → U2 → U3 → U4.

### Implementation constraints

- TDD for remaining tailor/smoke behavior. Temporarily break an assertion if tests were written after the cut to confirm they would catch a regression.
- No Batch worker, no prompt-file rewrite, no new LLM call on smoke.
- Match existing discriminated-union and env-helper patterns.

---

## Implementation Units

### U1. Remove on-path critique-revise

- **Goal:** Tailor pipeline is a single curator call.
- **Requirements:** R1, AE1.
- **Files:** `app/api/lib/tailor-pipeline.ts`, `app/api/lib/adversarial-judge.ts` (delete), `tests/critique-revise-loop.test.ts`, `tests/adversarial-judge.test.ts` (delete), `tests/helpers/tailor-request.ts`, `docs/api/API.md`.
- **Approach:** Red: tests that pipeline/chat is invoked once and `critiqueCvDraft` is not imported. Green: delete the `CRITIQUE_REVISE_ENABLED` block and judge helpers from the pipeline; delete `adversarial-judge.ts`. Strip critique env from the test helper.
- **Test scenarios:** (1) successful tailor with former critique env set still one `chat` call; (2) flexible cover letter still returned without a revise pass; (3) deleted module has no remaining imports (`npm test` / typecheck).
- **Verification:** `npm test` covering tailor-pipeline / critique tests; `npm run lint`.
- **Dependencies:** none.

### U2. Remove smoke judges and gates

- **Goal:** Smoke is artifacts + structural checks only.
- **Requirements:** R2, R3, AE2, AE3.
- **Files:** `app/api/lib/smoke-runner.ts`, `app/api/lib/smoke-helpers.ts`, `scripts/e2e-tailor-cv.ts`, `tests/smoke-runner.test.ts`, `tests/smoke-helpers.test.ts`, `tests/e2e-tailor-cv.test.ts`.
- **Approach:** Red: success path does not call score fns; no `gatePassed` / grounding fields required; failure still at health/tailor/docx. Green: cut judge invocation and gate evaluation; shrink success/failure types; CLI logs PASS tailor + artifacts only. Keep redact-by-default writes and flexible cover-letter DOCX behavior.
- **Test scenarios:** (1) valid tailor → success without judge mocks; (2) health/tailor/docx/schema failure still fails; (3) no `stage: "judges"`; (4) CLI/helper tests no longer assert score gates or require `judgeModel` / mins.
- **Verification:** `npm test` on smoke tests.
- **Dependencies:** none (type cleanup vs eval-judge may leave a brief unused import until U3).

### U3. Delete unused judge modules and env

- **Goal:** No production-dead judge stack or env catalog entries.
- **Requirements:** R5 (env/docs catalog), R2.
- **Files:** `app/api/lib/eval-judge.ts` (delete if unreferenced), `tests/eval-judge.test.ts`, `lib/env.ts`, `app/api/lib/eval-schema.ts`, `app/api/lib/eval-extract.ts`, `app/api/lib/eval-defaults.ts`, `tests/env.test.ts`, `tests/eval-schema.test.ts`, `.env.example`, and any leftover judge prompt env.
- **Approach:** After U1–U2, grep for remaining production imports. Delete modules and tests with zero production callers. Remove getters and `.env.example` entries. Keep `eval-parse.ts`.
- **Test scenarios:** (1) `getEvalJudgeModel` / `EVAL_JUDGE_*` / `SMOKE_*_MIN` gone or unused; (2) `npm test` and `npm run typecheck:tests` pass; (3) `.env.example` has no judge/critique keys.
- **Verification:** `rg` for deleted symbols; `npm test`; `npm run lint`.
- **Dependencies:** U1, U2.

### U4. Rewrite quality story in STRATEGY and operator docs

- **Goal:** Docs match the judge-free product.
- **Requirements:** R4, R5, R6, R7, R8, AE4.
- **Files:** `STRATEGY.md`, `CONCEPTS.md`, `docs/arch/MODEL_SELECTION.md`, `docs/arch/APP_WALKTHROUGH.md`, `docs/arch/FILE_LAYOUT.md`, `docs/arch/README.md` (judge-eval notes only; keep Batch-deferred anti-pattern), `docs/test/TESTING.md`, `docs/api/API.md` (if any leftover), `AGENTS.md` learned facts about smoke judges, `docs/plans/2026-07-30-001-feat-judge-model-bakeoff-plan.md` (superseded notice).
- **Approach:** Replace judge-verdict metrics with human review + later user feedback. Smoke glossary: artifacts, not always-on judges. Stamp bakeoff plan: superseded by this file; do not implement. Do not create `docs/plans/README.md` on this branch.
- **Test scenarios:** none beyond existing env/doc invariant tests; if a test asserts `EVAL_JUDGE_MODEL` in `.env.example`, update or delete it.
- **Verification:** `npm test`; skim STRATEGY + CONCEPTS Smoke entry.
- **Dependencies:** U3 (env names stable).

---

## Verification Contract

| Command | Applies | Proves |
|---------|---------|--------|
| `npm test` | After each unit | Tailor one-call; smoke without judges; no dangling imports |
| `npm run lint` | After U3/U4 | Clean |
| `npm run build` | Before done | Next.js build |
| `npm run smoke` | Optional operator | Artifacts without judge keys; not CI |

No `release:validate`. No live-API judges.

---

## Definition of Done

- R1–R8 and AE1–AE4 hold in code and current-behavior docs.
- U1–U4 complete; abandoned judge code not left in the diff.
- `npm test`, `npm run lint`, and `npm run build` pass.
- `STRATEGY.md` last_updated reflects this change.
- Historical completed plans may still mention judges as past tense; live docs must not instruct operators to configure smoke judges or critique-revise.
