---
title: "feat: Cross-model smoke parity matrix"
date: 2026-09-06
type: feat
topic: cross-model-parity-matrix
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# feat: Cross-model smoke parity matrix

## Goal Capsule

- **Objective:** Give the operator a repeatable way to smoke the same JD across a configured list of namespaced curator models, with non-colliding artifacts, so production confidence is an eyeball of files — not judge scores.
- **Authority:** This Product Contract. `STRATEGY.md` (inference cost + portable prompts; no LLM-as-judge). Board: M7 in `docs/plans/README.md`.
- **Open blockers:** None.
- **Stop when:** `SMOKE_PARITY_MODELS` is env-driven; `--parity` records the server’s `model` into `tmp/smoke/<provider>/<model>/` plus a status file; remaining models require a server restart with a new `TAILOR_MODEL`; default (non-parity) smoke paths stay flat.

## Product Contract

### Summary

The server still has one `TAILOR_MODEL`. A parity pass fills one matrix cell per process: smoke, namespace artifacts by the response `model`, record status, and tell the operator which catalog models still need a restart. No request-body model picker (metered keys). No judges.

### Problem Frame

`npm run smoke` overwrites `tmp/smoke/<jd-slug>.*` and only ever exercises the process env model. Historical `eval-results/` scores are retired. The operator has no checklist for Anthropic / DeepSeek / OpenRouter OpenAI / OpenRouter Google on the same JD.

### Key Decisions

- **Server `TAILOR_MODEL` remains the only model selector.** `(session-settled: user-directed — chosen over POST body override: unconstrained client model choice is a billing surface on shared keys)` Governs R1, R6.
- **One live tailor per smoke process; remaining cells are restart hints.** `(session-settled: user-approved — chosen over spawning N Next.js servers or in-process tailor: that overlaps M8.4 and is a new runtime)` Governs R2, R4, AE2.
- **Quality signal stays operator read of artifacts.** `(session-settled: user-directed — chosen over restoring score gates: judges are retired)` Governs R3, R5.
- **Default catalog is the MODEL_SELECTION production rows, env-overridable, strict-first.** `(session-settled: user-approved — chosen over EVAL_MODELS / flexible matrix: STRATEGY parks flexible commercial investment)` Governs R1, R7.

### Requirements

- R1. `SMOKE_PARITY_MODELS` is a comma-separated list of namespaced `provider/model` strings (default: `anthropic/sonnet`, `deepseek/deepseek-v4-pro`, `openrouter/openai/gpt-5.4-mini`, `openrouter/google/gemini-3.1-pro-preview`). Invalid/bare/unknown-provider entries fail closed.
- R2. `npm run smoke -- --parity` (or `npm run smoke:parity`) runs the existing smoke against the running server once. It writes dual artifacts under `tmp/smoke/<provider>/<model>/` using the tailor response `model` field.
- R3. Success/failure of that run is still health/tailor/schema/docx — not scores.
- R4. After a parity run, `tmp/smoke/parity-status.json` records the filled cell and lists catalog models still pending (restart with that `TAILOR_MODEL`).
- R5. Default smoke without `--parity` still writes `tmp/smoke/<jd-slug>.*` (no model subdir).
- R6. `POST /api/tailor-cv` does not gain a client model field.
- R7. `docs/arch/MODEL_SELECTION.md` and `docs/test/TESTING.md` describe the restart loop and pin `TAILOR_REASONING_EFFORT` for fair A/B. `.env.example` catalogs `SMOKE_PARITY_MODELS`.

### Scope Boundaries

- In: smoke helpers, smoke CLI, env catalog, operator docs, unit tests.
- Out: API model override; in-process tailor; spawning the Next server; judge scores; flexible as the default matrix; CI live-LLM; changing `DEFAULT_TAILOR_MODEL`.
- Deferred: M8.4 in-process core (could later fill many cells without restart).

### Acceptance Examples

- AE1. `--parity` against a server on `anthropic/sonnet` writes `tmp/smoke/anthropic/sonnet/<slug>.docx` and marks that cell filled. **Covers R2, R4.**
- AE2. The same run does not POST tailor for other catalog models; status lists them as pending with a restart hint. **Covers R4.**
- AE3. Bare `npm run smoke` still writes `tmp/smoke/<slug>.docx`. **Covers R5.**
- AE4. `SMOKE_PARITY_MODELS=sonnet` throws at parse time. **Covers R1.**

## Planning Contract

### Key Technical Decisions

- KTD1. **Parse/validate the catalog in `smoke-helpers.ts` via `detectProvider`; CSV default from `lib/env.ts` `getEnvString("SMOKE_PARITY_MODELS", DEFAULT)`.** Instantiates R1.
- KTD2. **Nest parity artifacts with `join(smokeRoot, ...model.split("/"))` (same shape as historical eval-results model segments).** Instantiates R2.
- KTD3. **`--parity` is a CLI flag next to `--flexible`; `npm run smoke:parity` passes it.** Instantiates R2.
- KTD4. **`parity-status.json` merge is last-write-wins per model key; pending models are catalog minus filled ok cells.** Instantiates R4.

### Assumptions

- Operator restarts `npm run dev` after changing `TAILOR_MODEL` (Next loads env at boot).
- Response `model` matches the server’s `TAILOR_MODEL`.

### Sequencing

U1 (helpers) → U2 (CLI + status) → U3 (docs/env).

## Implementation Units

### U1. Parity catalog and artifact nesting

- **Complexity:** Routine
- **Goal:** Parse `SMOKE_PARITY_MODELS`; compute model-nested smoke paths.
- **Requirements:** R1, R2, R5
- **Files:** `lib/env.ts`, `app/api/lib/smoke-helpers.ts`, `tests/smoke-helpers.test.ts`, `tests/env.test.ts`
- **Approach:** Add default CSV + getter. `parseSmokeParityModels` splits/trims and calls `detectProvider`. `smokeParityArtifactDir(root, model)` joins provider segments. Extend `smokeArtifactPaths` with optional `model` (omit → today’s flat paths).
- **Test scenarios:** default CSV four namespaced models; override CSV; bare alias throws; unknown provider throws; nested path for `anthropic/sonnet`; omitted model keeps flat paths.
- **Verification:** unit tests.

### U2. Smoke CLI `--parity`

- **Complexity:** Routine
- **Goal:** One smoke fill one cell; write status; hint remaining.
- **Requirements:** R2, R3, R4, R6
- **Files:** `scripts/e2e-tailor-cv.ts`, `tests/e2e-tailor-cv.test.ts`, `package.json`
- **Approach:** Parse `--parity`. On success, if parity: `artifactDir = smokeParityArtifactDir(tmp/smoke, result.model)` then `writeSmokeArtifacts`. Merge `parity-status.json`. Log pending models. Do not extra POST.
- **Test scenarios:** parity + mocked tailor `model: anthropic/sonnet` writes nested paths and status filled; other catalog models pending; without `--parity` flat paths; malformed catalog fails before fetch.
- **Verification:** `tests/e2e-tailor-cv.test.ts`.

### U3. Operator docs and env catalog

- **Complexity:** Routine
- **Goal:** Document the restart matrix and env.
- **Requirements:** R7
- **Files:** `.env.example`, `docs/arch/MODEL_SELECTION.md`, `docs/test/TESTING.md`, `docs/plans/README.md` (M7 plan link), `CONCEPTS.md` if the term is missing
- **Approach:** Catalog `SMOKE_PARITY_MODELS`. Describe `--parity`, artifact layout, `TAILOR_REASONING_EFFORT` pin, no judges.
- **Test expectation:** none — docs; env getter covered in U1.
- **Verification:** `.env.example` has the key.

## Verification Contract

| Command | Applies | Proves |
|---------|---------|--------|
| `node --test tests/smoke-helpers.test.ts tests/e2e-tailor-cv.test.ts tests/env.test.ts` | U1–U2 | Catalog + CLI |
| Temporarily invert one new assertion | U1 or U2 | Characterization/TDD red |
| `npm test` | After units | Suite (ignore pre-existing eval-results fails on main) |
| `npm run lint` | After | Clean |

## Definition of Done

- R1–R7 and AE1–AE4 hold.
- No `POST` model field.
- Default smoke paths unchanged without `--parity`.
- M7 plan linked from the README (lane stays `lfg` until drain `awaiting-merge`).
