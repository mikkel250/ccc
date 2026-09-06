---
title: "Flexible Curation Posture & Critique-Revise Loop"
type: feat
date: 2026-07-27
deepened: 2026-07-27
source: docs/brainstorms/2026-07-27-flexible-transferable-skills-posture-brainstorm.md
status: parked
---

> **Parked / partially superseded.** Critique-revise is retired by [`2026-09-03-001-feat-retire-llm-judges-plan.md`](./2026-09-03-001-feat-retire-llm-judges-plan.md). `flexible` as a commercial path is STRATEGY “Not working on.” Cover-letter artifact work shipped separately. Do not implement the critique loop from this plan.

# Flexible Curation Posture & Critique-Revise Loop

## Overview

Replace the current `flexible` curation mode (which shares the Struan domain-matching framework with `strict`) with a new **JD-backwards competency mapping** posture. Add a unified **critique-revise loop** (adversarial recruiter judge → curator revision) across both modes. `flexible` additionally generates a cover letter artifact. All content stays grounded in the master CV — no invented facts. After the curator revision, enforce **deterministic grounding** (not only schema shape): validate each final claim or extracted fact against the master CV and require evidence references before accepting either mode’s curated output or flexible’s cover letter. On grounding failure, reject the revision and retain the last grounded draft (or mark the artifact for regeneration) rather than shipping ungrounded content.

## Problem Statement

Today's `flexible` mode is a variant of `strict` — both operate on the same Struan 8-part framework with the same domain-matching selection lens. `flexible` adds title tailoring, role merging, and grounded compression, but retains the same fundamental approach: match the JD's domain, score fit against must-haves. For a career pivoter applying across industry boundaries, this either stretches claims to look like a fit, or correctly scores itself as a weak fit without surfacing the transferable value that's actually there.

Additionally, the current pipeline is a single-pass LLM call with no quality feedback mechanism. Even when the curator produces a CV with narrative weaknesses, overqualification signals, or ATS keyword gaps, there's no mechanism to catch and fix those issues before the response goes to the user.

## Proposed Solution

Four implementation phases, re-ordered by dependency to tackle structural readiness first:

### Phase 1: Pipeline Extraction (Foundation)

- **Complexity:** Complex
- **Reason:** Multi-file coordinated change (new module + route rewrite + test split); introduces new abstraction (`buildTailorResponse`); touches public API surface.

Extract the existing inline logic from `route.ts` into a testable pipeline module.
- Creates `app/api/lib/tailor-pipeline.ts` with `buildTailorResponse(deps, request)`
- Shrinks `route.ts` to a thin HTTP wrapper
- Ensures the subsequent multi-call loop can be cleanly unit-tested without HTTP mocking.
*(Note: Originally deferred, this is now prioritized as a prerequisite for the loop).*

### Phase 2: New Curator Prompt & Response Shape (`flexible` posture)

- **Complexity:** Difficult
- **Reason:** Prompt design is inherently iterative with cross-model parity constraint; response shape change touches API contract; open questions about edge cases and migration; quality requires manual smoke verification.

Rewrite the `flexible` mode's curator prompt to implement JD-backwards competency mapping:

- **JD Deconstruction step:** extract underlying competencies from the JD beneath domain jargon (e.g. "manage FOH team, control COGS" → people leadership, P&L ownership). *Handling for thin JDs:* if JD lacks detail, default to generic professional leadership/execution competencies.
- **Competency Mapping step:** map JD competencies to specific master CV evidence (internal, not emitted). *Anomalous Signal rule:* explicitly preserve high-value outlier signals (e.g., prestigious awards) even if they don't map to the JD.
- **Category-based experience reorganization:** group experience entries into JD-derived categories ("Operations & Management", "Technical Leadership") rather than chronological sections
- **Skills section rewritten:** foreground JD-relevant skill categories, consolidate domain-specific skills
- **OVS becomes JD-aware thesis** in `flexible` (2-3 sentences identifying transferable strengths), stays evergreen in `strict`
- **Grounding check:** explicit final verification against master CV
- **Cover Letter Generation:** Generated alongside the CV in the same LLM call (returned as a markdown string in the response payload). `strict` mode omits this.

### Phase 3: Adversarial Judge

- **Complexity:** Complex
- **Reason:** New module + deps bag change; introduces new pattern (first on-path judge, unlike existing smoke-only judges); well-isolated with clear inputs/outputs; doesn't directly touch API contract.

Add a new on-path judge that critiques the curator's first draft before it goes to the user:

**Persona:** "You are an experienced recruiter with 20+ years in [JD domain]. Review this CV critically — would you advance this candidate? What would make you reject them?"

**Evaluation dimensions:**
- Narrative coherence — does the CV tell one clear story?
- Skepticism preemption — does it acknowledge the domain switch honestly?
- Overqualification risk — flight risk signals?
- ATS viability — keyword gaps that would cause filtering?
- Red flags — inconsistent dates, unexplained gaps, missing metrics, title inflation
- **Hallucination check (in-loop):** Does the draft suspiciously add identical wording from the JD that isn't plausible given the rest of the career?
- **Alignment (flexible only):** Does the cover letter directly contradict or misrepresent the CV?

**Implementation:**
- New file: `app/api/lib/adversarial-judge.ts`
- Uses existing `chat()` from `llm.ts` with its own configured model (`ADVERSARIAL_JUDGE_MODEL`, defaulting to `getTailorModel()`).
- Judge prompt is env-configurable: `ADVERSARIAL_JUDGE_PROMPT`.

### Phase 4: Critique-Revise Loop

- **Complexity:** Difficult
- **Reason:** Cross-cutting architectural change affecting entire pipeline flow; multiple partial-failure modes; latency and usage tracking implications; plan flags specific risks (context window blow-out, revision hallucination).

Add the feedback loop to the newly constructed `tailor-pipeline.ts`: curator draft → judge critique → curator revise → output.

**Loop structure (fixed 2-pass):**
```
1. Curator LLM call → first draft (curated JSON + optional cover letter)
2. Adversarial judge LLM call → structured critique
3. Curator LLM call → revised draft incorporating critique
4. Parse → schema validate → size check → docx → response
```

**Design decisions:**
- The critique is fed back to the curator. **Crucial restriction:** The revise prompt must heavily prioritize anti-hallucination—"Do NOT invent facts to satisfy the judge's critique. If a gap exists, leave it or address it honestly in the cover letter."
- If the judge LLM call fails, fall back to returning the first draft.
- If the curator revise LLM call fails, return the first draft.

## Key Technical Decisions

### Decision 1: Pipeline extraction first (Phase 1)

**Choice:** Extract the pipeline into `tailor-pipeline.ts` before any prompt or loop work. Route.ts becomes a thin HTTP wrapper.

**Alternatives considered:** Add loop inline first, extract later. Simpler initially but makes route.ts even longer — the loop is 3 LLM calls with error handling for each. Pipeline extraction was already planned in `docs/plans/2026-07-23-refactor-extract-entrypoint-complexity-plan.md`.

**Rationale:** The loop logic (~40 lines of orchestration) justifies its own testable module. Pipeline extraction was already planned; the loop makes it necessary rather than optional.

### Decision 2: Fixed 2-pass loop (not dynamic)

**Choice:** Curator draft → judge critique → curator revise. Fixed at 2 passes. No dynamic iteration.

**Alternatives considered:** Dynamic loop (judge → revise → judge again) — more thorough but unpredictable latency and cost. Risk of infinite loops if judge and curator disagree. No loop — simpler but no quality feedback (the status quo).

**Rationale:** Most recruiter critiques are addressable in one revision pass. If the critique requires changes the curator can't make (e.g. "add a skill the candidate doesn't have"), the curator's grounding + anti-hallucination restriction catches it.

### Decision 3: Judge failure → return first draft (not fail)

**Choice:** If the judge or curator revise LLM call fails, log a warning and return the curator's first draft.

**Alternatives considered:** Fail the request with 503 — strict mode users (who don't need the loop as badly) would see regressions from judge outages. Retry with backoff — adds latency and still might fail.

**Rationale:** The loop is a quality improvement, not a hard gate. A first-draft CV is still useful. Judge unavailability should degrade gracefully.

### Decision 4: Adversarial judge as separate module

**Choice:** New file `adversarial-judge.ts` — separate from the existing smoke-only `eval-judge.ts`.

**Alternatives considered:** Add to `eval-judge.ts` — co-locates all judges but mixes on-path and smoke-only concerns. `eval-judge.ts` imports heavy extraction/judge-map types irrelevant to the adversarial judge.

**Rationale:** On-path (request-critical) and offline (smoke diagnostic) judges have different failure modes and dependencies. Separate modules keep the request path auditable.

### Decision 5: Cover letter is flexible-only

**Choice:** Cover letter generated only for `flexible` mode. `strict` mode response has `coverLetter: undefined`.

**Alternatives considered:** Cover letter for both modes — unified output shape but adds noise for linear-career candidates. No cover letter — simpler but pivot roles consistently require one.

**Rationale:** The pipeline *structure* is unified (both modes get the loop), but the *output shape* varies by mode. Consistent with `curationModePolicy` already varying by mode.

## Open Questions

Carried forward from the brainstorm, unresolved:

1. **Edge cases for competency mapping** — (a) JD has no transferable competencies (purely domain-specific). (b) Master CV has zero evidence for any JD competency. (c) JD is poorly written (vague, buzzword-heavy). (d) Candidate has multiple competing career tracks. The prompt now handles thin JDs with generic competencies and anomalous signals, but fallback behavior needs explicit testing.

2. **Adversarial judge persona specificity** — Domain-specific ("hospitality recruiter with 20 years") vs generic ("cross-industry recruiter"). Domain-specific is more realistic but requires JD domain extraction and injection into the judge prompt. Deferred to Phase 3 implementation.

3. **Tenure honesty guardrails** — Listed as a separate track in STRATEGY.md. Prompt-level, code-level, or both? Not scoped into this plan.

4. **Cross-model parity testing plan** — Which models, which JD/candidate pairs, what acceptance threshold? Deferred to a follow-up smoke-hardening plan.

5. **Migration path for existing `flexible`** — Replace immediately or run as `flexible-v2` alongside during testing? An env-gated rollout (`FLEXIBLE_POSTURE=v2`) would be safer for A/B comparison.

## Technical Considerations

### Schema Compatibility

The master CV schema (`references/json-curator/master-cv.schema.json`) requires experience entries with `title` + `dates` + oneOf `bullets[]` or `subroles[]`. Category-based group titles like "Operations & Management" are already schema-compatible. No schema changes needed.

### Langfuse Prompt Management

New Langfuse prompt names:
- `cv-curator-flexible-pivot` (new flexible posture prompt)
- `cv-adversarial-judge` (judge prompt)
- The hardcoded fallbacks live in `curator-prompt.ts` and `adversarial-judge.ts` respectively.

### Latency Budget

Current: 1 LLM call per request. New: 3 LLM calls. Estimated per-call timing:
- Curator draft: ~15-25s (long prompt with full master CV JSON, long output with curated CV + optional cover letter)
- Judge: ~3-6s (short prompt — no master CV JSON, short output — structured critique only)
- Curator revise: ~10-20s (long prompt again, but revision is typically faster than initial draft)
- Total: ~28-51s vs current ~15-25s

Mitigations:
- Use a fast/cheap model for the judge (`ADVERSARIAL_JUDGE_MODEL` should be configured to a faster model in production — e.g. `openrouter/openai/gpt-5.4-mini`)
- The judge prompt is short (no master CV JSON, no framework description) — typically <1K input tokens
- **Opt-in by default:** `CRITIQUE_REVISE_ENABLED=false`. Do not enable in production until latency and quota controls are sized.
- Required controls before enabling: wall-clock budget (`CRITIQUE_REVISE_BUDGET_MS`), per-call timeouts (`CRITIQUE_REVISE_CALL_TIMEOUT_MS` / `ADVERSARIAL_JUDGE_TIMEOUT_MS`), and preferably weighted per-call or token quotas (draft + judge + revise) so three LLM calls cannot exhaust a single-request bucket silently.
- Rate limiting remains per-request (unchanged) — the 3 LLM calls still count as one request for rate-limit purposes; that is why weighted quotas / budget timeouts are prerequisites for opt-in.

### Usage Tracking

With 3 LLM calls per request, usage tracking aggregates:
- `usage.promptTokens` = sum of all calls
- `usage.completionTokens` = sum of all calls
- `usage.totalTokens` = sum of all calls
- Each call is traced separately in Langfuse/LangSmith for debugging (same `traceId`, different `generation` records)
- Source labels: `tailor-cv-curator` (draft), `tailor-cv-judge`, `tailor-cv-revise`

### Cross-Model Parity

The new posture and judge must work across providers (Anthropic, OpenAI, Google, DeepSeek). Testing plan:
- Smoke tests with pivot JDs across all providers
- The adversarial judge model defaults to `getTailorModel()` but can be overridden via `ADVERSARIAL_JUDGE_MODEL`
- Judge persona adapts per JD domain — domain extraction is part of the judge prompt, not hardcoded
- Risk: prompt too long for weaker models (Gemini Flash, DeepSeek). Mitigation: test with all providers; trim non-essential prompt content if needed

### System-Wide Impact

**API contract:** `coverLetter` field added to response. Backwards compatible — existing clients ignore unknown JSON fields. No breaking changes. API documentation in `docs/api/API.md` needs updating.

**Langfuse:** Two new prompt names (`cv-curator-flexible-pivot`, `cv-adversarial-judge`) or one updated (`cv-curator-json`). Each LLM call (draft, judge, revise) is a separate Langfuse generation with the same trace. Langfuse prompt versioning should track which prompt was used for each generation.

**Smoke tests:** `scripts/e2e-tailor-cv.ts` (and eventual `smoke-runner.ts`) need updating: expect `coverLetter` in response for flexible mode, accept increased latency, validate judge output exists. Existing `scoreJsonGrounding` and `scoreJsonJdFit` judges continue to work — the curated JSON output shape is unchanged.

**Error propagation:** The loop introduces partial-failure states not present in the single-pass pipeline: (a) curator draft fails → 503 as today, (b) judge fails → log warning, return first draft, (c) curator revise fails → log warning, return first draft, (d) context window blow-out on revise → exclude original JD from revise call, only send draft + master CV + critique. The `safeTailorLog` pattern in route.ts covers these.

**Schema validation:** Unchanged. Category-based titles are already valid under the experience schema (only `title` + `dates` are required).

**.env.example:** New entries needed: `ADVERSARIAL_JUDGE_MODEL`, `ADVERSARIAL_JUDGE_PROMPT`, `CRITIQUE_REVISE_ENABLED`.

## Acceptance Criteria

### Phase 1: Pipeline Extraction
- [ ] `app/api/lib/tailor-pipeline.ts` exists with `buildTailorResponse(deps, request)`
- [ ] `route.ts` POST handler is ≤50 lines

### Phase 2: Curator Prompt & Payload
- [ ] `app/api/lib/curator-prompt.ts` — new `FLEXIBLE_PIVOT_FALLBACK_PROMPT` constant mapping
- [ ] Thin JD edge case and high-value internal fallback documented functionally in the prompt text
- [ ] `coverLetter` field in response JSON for `flexible` mode (markdown formatting)
- [ ] OVS is JD-aware thesis in `flexible`

### Phase 3: Adversarial Judge
- [ ] `app/api/lib/adversarial-judge.ts` exists with `critiqueCvDraft()`
- [ ] Judge prompt configured via `ADVERSARIAL_JUDGE_PROMPT`
- [ ] Evaluates new dimensions (hallucination, alignment, narrative cohesion)

### Phase 4: Critique-Revise Loop
- [ ] Loop sequence correctly wired into `tailor-pipeline.ts`
- [ ] Fallbacks explicitly tested (judge timeout/failure -> returns Draft 1)
- [ ] Curator Revise handles critique without inventing facts (tested via edge-case smoke test)

### Cross-Cutting
- [ ] `npm test` passes with same or higher pass count
- [ ] Manual smoke test with pivot JD produces coherent output with cover letter

## Dependencies & Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| 3x latency increase | User-facing slowdown | Judge uses fast model; loop configurable via env. |
| Judge LLM failures mid-loop | Lost critique, wasted curator call | Fall back to first draft; log warning; don't fail request |
| Context window blow-out on Revise | Token limits hit | Exclude original JD from revise call if needed; only send draft, Master CV, and Critique |
| Revision hallucination | To satisfy the judge, Curator Invents facts | The revise prompt explicitly prioritizes honest gaps over fabrications; in-loop judge hallucination check |
| Schema validation failures | 422 errors | Category titles schema verified. Smoke tests enforce JSON integrity |

## References

- Brainstorm: `docs/brainstorms/2026-07-27-flexible-transferable-skills-posture-brainstorm.md`
- Strategy: `STRATEGY.md` — Pivot curation posture track
- Prior plan: `docs/plans/2026-07-23-refactor-extract-entrypoint-complexity-plan.md`
- Architecture: `docs/arch/README.md`
