---
name: CCC
last_updated: 2026-07-28
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

For the `flexible` / pivot path, success is **not** a checklist of scored sub-dimensions. The primary signal is a judge verdict: **is this curated CV strong enough for this JD?** — honest about tenure/domain, and clear about what actually transfers. If a hiring-aware reader (or LLM judge standing in for one) would say “yes, submit this,” the posture worked.

Supporting signals (honesty floor, not optimization targets):

- **Grounding** — no invented facts/metrics/employers (`scoreJsonGrounding`; existing smoke gate stays as a floor)
- **Tenure honesty** — no summed-overlapping-span or off-domain-rebranded tenure claims (most-cited recurring failure)
- **Transferable skills surfaced** — the CV names/foregrounds what transfers; not merely a same-domain cull that then scores itself as a weak fit
- **JD-fit score** — tracked for `strict` and for regression visibility; for `flexible`, must not override the “strong enough” verdict above

`strict` keeps today’s smoke hard-fail gates (`SMOKE_GROUNDING_MIN` / `SMOKE_JD_FIT_MIN`). Pivot evaluation uses `--flexible` and judges the holistic bar, not a weighted composite of the bullets above.

## Tracks

### Pivot curation posture

Build the new thesis-first `flexible` prompt/path that does the actual transferable-skills translation work.

_Why it serves the approach:_ this track is the approach itself — the direct execution of giving `flexible` a separate, transferable-skills-first path instead of a patched Struan.

### Tenure honesty

Guardrails (prompt- and/or code-level) that stop overlapping-span summing and off-domain-years rebranding, in either curation mode.

_Why it serves the approach:_ a transferable-skills posture is worthless if it also overclaims tenure — this is the credibility floor the approach depends on.

### Judge coverage

Add a smoke-path judge that answers the primary question — **strong enough for this JD?** — with tenure honesty and transferable-skills visibility as inputs to that verdict, not separate scoreboards to game.

_Why it serves the approach:_ without that feedback loop, “did the new posture actually work” stays a guess.

### Cross-model parity

Verify the new `flexible` posture holds up across providers with a **pinned** matrix — not provider defaults, and not tuned to whichever model authored the prompt.

**Matrix (identical for every cell):**

| Knob | Pinned value |
|------|----------------|
| Prompt revision | Same curator/flexible prompt git SHA (and Langfuse prompt version if used) for all cells |
| `AI_TEMPERATURE` | `0.3` (`.env.example` default) |
| `AI_MAX_TOKENS` | `8192` (`.env.example` default) |
| `TAILOR_REASONING_EFFORT` | `medium` on every cell that supports it |
| Curation mode | `flexible` |
| Smoke sample | Shared JD set across all cells |

**Models under test** (namespaced IDs; pin exact strings, no floating aliases):

| Family | Model ID |
|--------|----------|
| Gemini | `openrouter/google/gemini-3.1-pro-preview` |
| Sonnet | `anthropic/sonnet` |
| GPT | `openrouter/openai/gpt-5.4` |
| DeepSeek | `deepseek/deepseek-v4-pro` |

**Reasoning-control fallback:** OpenRouter cells send `reasoning.effort`; DeepSeek direct maps via `thinking` + `reasoning_effort` (see `.env.example`). If a provider lacks an equivalent control (today: direct Anthropic/`callAnthropic` ignores `TAILOR_REASONING_EFFORT`), keep the env pin set for the whole matrix, document that cell as **control unsupported**, and still compare on identical prompt / temperature / max tokens — do **not** unset the pin on other providers to “match” that default. Before claiming parity, confirm each model accepts the pinned request shape (no silent drop of settings).

**Pass:** on the shared sample, each model clears the holistic “strong enough” bar (and the grounding honesty floor). Parity fails if one provider systematically cannot produce a submit-worthy pivot CV under the same pinned settings.

_Why it serves the approach:_ production stays cross-model by project constraint — a posture that only works on one provider isn't shippable.

## Not working on

- Multiple per-industry master CVs (one master stays canonical; curation, not duplication, does the work)
- Heavy mechanical allowlists for grounding (prefer LLM judges; add allowlists only if manual failures justify it)
- Page-count as a hard requirement (prefer shorter where possible, but content quality and honest fit win over length)
