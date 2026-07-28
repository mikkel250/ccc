---
name: CCC
last_updated: 2026-07-27
---

# CCC Strategy

## Target problem

Career pivoters working from one complete, honest master CV need a curated CV that honestly foregrounds their transferable experience (e.g. management skill transferring across industries) for an unfamiliar target domain. Today's curation logic has no mechanism for that translation — it either stretches tenure/domain claims to look like a fit, or correctly scores itself as a weak fit without ever surfacing the transferable value that's actually there.

## Our approach

Treat linear-career and cross-industry-pivot curation as two genuinely different problems, not one framework patched to cover both. `strict` keeps the Struan in-field-specialist framework for linear-career applicants. `flexible` becomes a separate, transferable-skills-first curation path built for pivots — not a variant instruction block bolted onto Struan, and not solved by maintaining multiple per-industry master CVs.

## Who it's for

**Primary:** Pivot job seeker — someone with one honest, complete career history applying across an industry boundary. They're hiring CCC to produce a curated CV that honestly leads with what actually transfers (e.g. management experience), instead of stretching tenure/domain claims or bailing out to a weak, unhelpful fit score.

**Secondary:** Linear-career job seeker — already served by `strict`; must not regress while `flexible` is reworked.

## Key metrics

- **Grounding score** - 0.0–1.0, no invented facts/metrics/employers; existing hard-fail gate (`scoreJsonGrounding`)
- **Tenure-accuracy rate** - % of smoke runs with zero summed-overlapping-span or off-domain-rebranded tenure claims; the single most-cited recurring failure
- **Transferable-skills-surfaced score** - new judge dimension: did the curated CV name/foreground genuinely transferable skills for the JD's domain, not just cut same-domain content
- **JD-fit score** - 1–5, existing (`scoreJsonJdFit`); tracked but no longer optimized for at the expense of the above three

## Tracks

### Pivot curation posture

Build the new thesis-first `flexible` prompt/path that does the actual transferable-skills translation work.

_Why it serves the approach:_ this track is the approach itself — the direct execution of giving `flexible` a separate, transferable-skills-first path instead of a patched Struan.

### Tenure honesty

Guardrails (prompt- and/or code-level) that stop overlapping-span summing and off-domain-years rebranding, in either curation mode.

_Why it serves the approach:_ a transferable-skills posture is worthless if it also overclaims tenure — this is the credibility floor the approach depends on.

### Judge coverage

Add the tenure-accuracy and transferable-skills-surfaced judge dimensions to the smoke pipeline.

_Why it serves the approach:_ without measuring these two things, the other tracks have no feedback loop and "did the new posture actually work" stays a guess.

### Cross-model parity

Verify the new `flexible` posture holds up across providers (Gemini, Sonnet, GPT, DeepSeek) with reasoning effort pinned, not tuned to whichever model wrote the prompt.

_Why it serves the approach:_ production stays cross-model by project constraint — a posture that only works on one provider isn't shippable.

## Not working on

- Multiple per-industry master CVs (one master stays canonical; curation, not duplication, does the work)
- Heavy mechanical allowlists for grounding (prefer LLM judges; add allowlists only if manual failures justify it)
- Page-count as a hard requirement (prefer shorter where possible, but content quality and honest fit win over length)
