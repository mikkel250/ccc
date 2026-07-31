---
title: "Judge Model Bakeoff - Plan"
date: 2026-07-30
type: feat
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
status: deferred
---

# Judge Model Bakeoff - Plan

## Goal Capsule

- **Objective:** Let an operator compare multiple judge models on the same curated CV (and related inputs) so smoke eval judges and the on-path adversarial judge can be calibrated with evidence, not habit.
- **Product authority:** Operator quality tooling under STRATEGY “Judge coverage” / smoke-quality roadmap; not a user-facing product surface.
- **Open blockers:** Resume only after smoke is modularized (`verifySmokePipeline` / smoke-runner extraction). Exact CLI shape, gate vs report-only, and whether bakeoff and tailor share one invocation are planning decisions.

## Product Contract

### Summary

Park a multi-judge-on-same-CV bakeoff until smoke is a library. When built, the operator runs N named judge models against one fixed master + curated + JD (and, for adversarial, the critique inputs) and gets a comparable score/critique table without re-tailoring for every model.

### Problem Frame

Tailor model choice is comparatively settled. Judge models (`EVAL_JUDGE_MODEL` for smoke grounding/JD-fit, `ADVERSARIAL_JUDGE_MODEL` for the critique-revise loop) have not been A/B’d. Today smoke runs one eval judge model per pass and never invokes the adversarial judge itself; swapping env and re-running smoke re-tailors and mixes variables.

### Key Decisions

- **Roadmap first, not ship now** — document intent and park implementation until after smoke-runner modularization. `(session-settled: user-directed — chosen over standalone bakeoff-now or folding into a large smoke-hardening plan before extraction: extract reusable smoke first, then add bakeoff on that foundation)`
- **Both judge surfaces in scope for the eventual bakeoff** — smoke post-hoc eval judges and the on-path adversarial judge both warrant comparative evaluation. `(session-settled: user-directed — chosen over smoke-only or adversarial-only as the sole calibration target: both still need evidence)`
- **Same-CV constraint** — comparison must hold curated CV (and JD/master) fixed across candidate judge models so differences are attributable to the judge, not a new tailor run.
- **Do not build as a one-off side script forever** — hang bakeoff on modular smoke / first-class smoke direction rather than a permanent parallel CLI.
- **Judge-only evaluation handoff** — add a `verifySmokeJudges(opts)` function to `smoke-runner.ts` that accepts precomputed tailor output (`curatedJson`, `docxBase64`, optional `coverLetter`) alongside a list of judge models and evaluates all of them against the same inputs. The existing `verifySmokePipeline` is extended with a `skipTailor` option: when set, it skips the health-check + POST steps and calls `verifySmokeJudges` with the provided precomputed inputs. The bakeoff CLI calls `verifySmokePipeline` once with no `skipTailor` to produce the inputs, then calls `verifySmokeJudges` with each candidate judge model. Acceptance tests enforce: (a) exactly one tailor POST per bakeoff run, (b) all requested judge models receive the same curated JSON and JD, (c) results include per-model scores and gate outcomes in a comparable structure.

### Requirements

**Outcome**

- R1. An operator can evaluate two or more namespaced judge models against the same master CV, curated CV, and JD without requiring a new tailor call per judge model.
- R2. The bakeoff covers smoke grounding and JD-fit scoring surfaces.
- R3. The bakeoff covers the adversarial (critique) judge surface with inputs appropriate to that judge (draft/context it would see on-path), so adversarial model choice can be compared independently of smoke eval models.
- R4. Results are presented per model in a form that supports picking defaults for `EVAL_JUDGE_MODEL` and `ADVERSARIAL_JUDGE_MODEL` (scores and/or critique summaries, plus parse/transport failures called out).

**Sequencing**

- R5. Implementation is deferred until smoke core logic is importable as a library (smoke-runner / `verifySmokePipeline` extraction from the existing extract-entrypoint plan).
- R6. Until then, STRATEGY (or equivalent roadmap) records this capability as planned operator tooling, not active build work.

### Scope Boundaries

**In scope (when resumed)**

- Operator-only comparison tooling for judge model selection.
- Reuse of existing judge prompts/behaviors; no redesign of grounding, JD-fit, or adversarial criteria in this feature.

**Deferred**

- Holistic “strong enough?” smoke judge (STRATEGY Judge coverage track).
- Cross-model parity matrix for curator/`flexible` (separate STRATEGY track).
- User-facing “paste JD, get CV” product UI.
- Changing production defaults without an operator-run comparison.

**Out of scope**

- Replacing smoke hard-fail gates with multi-judge consensus on every smoke run by default.
- Mechanical claim-graph allowlists as a substitute for judge calibration.

### Acceptance Examples

- AE1. Given a saved curated JSON + JD + master from a prior smoke, running the bakeoff with models A and B yields grounding and JD-fit results for both without calling tailor.
- AE2. Given the same fixed draft inputs, bakeoff reports adversarial critique outputs (or structured scores if defined) for models A and B side by side.
- AE3. A parseFailed or transport error for one model does not silently drop that model from the report.
- AE4. The bakeoff makes exactly one POST to /api/tailor-cv regardless of how many judge models are evaluated; all judges receive the same curated JSON, JD, and master CV from that single tailor run.

### Assumptions

- Operator has provider keys for every candidate judge model.
- Existing judge contracts remain the comparison axes unless a later plan changes them.
- Adversarial bakeoff may need a draft curated CV from a tailor run (or fixture); it does not require critique-revise to be enabled on the live server for the comparison itself.

### Outstanding Questions

- Report-only vs optional hard-fail against `SMOKE_*_MIN` for a designated primary model.
- Whether bakeoff is a smoke subcommand/flag or a sibling npm script after extraction.
- How many models/JDs constitute a “good enough” calibration set before changing env defaults.
