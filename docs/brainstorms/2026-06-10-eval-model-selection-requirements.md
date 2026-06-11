# Eval Model Selection Requirements

**Session:** 2026-06-10  
**Status:** Refined test matrix — ready for `.env` update and re-run of `scripts/eval-cv.ts`

## Summary

**Quality-first model discovery**: Anthropic (Haiku / Sonnet / Opus) is the known-good quality baseline. The goal is to find non-Anthropic models that can *meet or beat* Anthropic quality for each task — then pick the cheaper option when quality is equivalent. Flex pricing on OpenAI and Google models (~50% off via `service_tier: "flex"`) makes them strong candidates to displace Anthropic on both quality and cost axes.

**Core experiment**: can correctly-prompted DeepSeek V4 Pro match Sonnet for CV tailoring? Can Gemini 3.1 Pro match Opus? Can Qwen3.7-Max or MiMo V2.5 Pro surprise from outside the big 3? Nine generators tested against Anthropic controls; three judge providers for cross-validation.

## Problem

Eval runs are judge-heavy: relevance and hallucination scorers send the full knowledge base (~30k tokens), generated CV, and structured extraction per call, with only a small JSON score in return. Current defaults lean on `anthropic/sonnet` as judge, which is expensive ($3/$15 per 1M tokens). The project already knows Anthropic quality — the gap to fill is whether non-Anthropic alternatives can match it at lower cost.

## Requirements

### Production CV generation

- **TAILOR_MODEL:** `deepseek/deepseek-v4-pro`
- Rationale: Frontier-tier quality at ~$0.435/$0.87 per 1M tokens (permanent list price as of May 2026). Must be included in `EVAL_MODELS` so eval benchmarks the production model.

### Stage 1 — JD extraction

- **EVAL_EXTRACTION_MODEL (primary):** `openrouter/openai/gpt-5.4-mini` — matches `.env.example` and the Key Decisions table; proven for structured JSON extraction.
- **EVAL_EXTRACTION_MODEL (budget alternative):** `deepseek/deepseek-v4-flash` — ~5× cheaper ($0.098/$0.197 per 1M). Use when calibration shows Flash passes the extraction gate; if judge scores fall below `EVAL_EXTRACTION_MIN_SCORE` (0.7), escalate to `deepseek/deepseek-v4-pro` or switch primary back to GPT-5.4-mini.
- **Extraction judge:** `openrouter/openai/gpt-5.4-mini` (cross-provider; lightweight — judges structured JSON only, not raw JD + KB).

### Stage 2 — CV judges (relevance + hallucination)

- **EVAL_JUDGE_MODEL (fallback):** `openrouter/google/gemini-3.1-pro-preview`
- Rationale: Balanced cost/quality for input-heavy calls ($2/$12 per 1M at ≤200k context). Stronger than mini-tier judges; cheaper effective cost than GPT-5.5 ($5/$30) or Sonnet ($3/$15) at ~98% input / ~2% output profile.
- **Cross-provider JUDGE_MAP** (via `EVAL_JUDGE_MAP_JSON`):

```json
{
  "deepseek/deepseek-v4-pro": "openrouter/google/gemini-3.1-pro-preview",
  "anthropic/sonnet": "openrouter/openai/gpt-5.4",
  "openrouter/google/gemini-3.1-pro-preview": "openrouter/openai/gpt-5.4",
  "openrouter/openai/gpt-5.4": "openrouter/google/gemini-3.1-pro-preview",
  "deepseek/deepseek-v4-flash": "openrouter/openai/gpt-5.4-mini"
}
```

### Eval candidate generators

**Phase 1 — CV tailoring quality discovery.** 9 generators + 2 Anthropic controls. Goal: find any model that meets or beats Sonnet on composite score.

| Priority | Model | Rationale |
|----------|-------|-----------|
| Control | `anthropic/opus` | Quality ceiling — what does "best possible" look like? |
| Control | `anthropic/sonnet` | Current winner (0.958 composite). The bar to beat. |
| Big 3 | `openrouter/openai/gpt-5.5` | OpenAI's best. Most likely Sonnet-competitor. |
| Big 3 | `openrouter/openai/gpt-5.4` | Proven all-rounder. Flex makes it cost-competitive. |
| Big 3 | `openrouter/google/gemini-3.1-pro-preview` | Google's best. Flex at $1/$6. |
| Non-big-3 | `deepseek/deepseek-v4-pro` | Current production (0.845). Re-test with current judges. |
| Non-big-3 | `openrouter/qwen/qwen3.7-max` | Alibaba's best — claims frontier-level. $1.25/$3.75. |
| Non-big-3 | `openrouter/xiaomi/mimo-v2.5-pro` | Xiaomi's best — claims DeepSeek-class. $0.435/$0.87. |
| Non-big-3 | `openrouter/minimax/minimax-m3` | Their latest generation. $0.30/$1.20. Dark horse. |

- **EVAL_MODELS:** `deepseek/deepseek-v4-pro,openrouter/qwen/qwen3.7-max,openrouter/xiaomi/mimo-v2.5-pro,openrouter/minimax/minimax-m3,openrouter/google/gemini-3.1-pro-preview,openrouter/openai/gpt-5.4,openrouter/openai/gpt-5.5,anthropic/sonnet,anthropic/opus`
- Anthropic models are **generators only**, not judges — they're the quality controls.
- Deferred (low probability of top-3): `openrouter/moonshotai/kimi-k2.6`, `openrouter/mistralai/mistral-large-2512`, `openrouter/z-ai/glm-5.1`. Add in follow-up if no clear winner emerges from the primary field.
- **GPT-5.4-mini** and **gemini-2.5-pro** retired from generator list — replaced by current-generation GPT-5.4/5.5 and Gemini 3.1 Pro.

## OpenRouter Flex Tier (June 2026 research)

`OPENROUTER_FLEX_ENABLED=true` already passes `service_tier: "flex"` on OpenRouter calls (`app/api/lib/llm.ts`). Flex applies to **OpenAI and Google only** — DeepSeek has no flex tier.

| Model | List (OpenRouter) | Flex (~50% off) | Est. $/judge call (40K in / 400 out) |
|-------|-------------------|-----------------|--------------------------------------|
| `openai/gpt-5.5` | $5 / $30 | **$2.50 / $15** | ~$0.11 (+ thinking risk) |
| `openai/gpt-5.4` | $2.50 / $15 | **$1.25 / $7.50** | ~$0.053 |
| `openai/gpt-5.4-mini` | $0.75 / $4.50 | **$0.375 / $2.25** | ~$0.016 |
| `google/gemini-3.1-pro-preview` | $2 / $12 | **$1 / $6** | ~$0.042 |
| `google/gemini-3-flash-preview` | $0.50 / $3 | **$0.25 / $1.50** | ~$0.011 |
| `google/gemini-2.5-pro` | $1.25 / $10 | **$0.625 / $5** | ~$0.030 |
| `deepseek/deepseek-v4-pro` | $0.435 / $0.87 | *none* | ~$0.018 |
| `deepseek/deepseek-v4-flash` | $0.098 / $0.197 | *none* | — |

**Thinking tokens:** Billed as output on both OpenAI GPT-5.x and Gemini 3.x; flex discount applies. GPT-5.5 defaults to `medium` reasoning — uncapped thinking can add $0.03–0.15/call at flex output rates. Judges should use `reasoning.effort: "minimal"` or `"low"` and cap `max_output_tokens` (~1500). Not yet configurable in eval judge calls — future hardening.

**GPT-5.5 flex verdict:** $2.50 input is real and attractive, but at 40K-input judge calls input still costs ~$0.10 vs ~$0.04 for Gemini 3.1 Pro flex. Reserve GPT-5.5 for eval **generator** ceiling tests, not routine judging.

Sources: [OpenRouter service tiers](https://openrouter.ai/docs/guides/features/service-tiers), [OpenAI flex processing](https://developers.openai.com/api/docs/guides/flex-processing), [Google flex inference](https://ai.google.dev/gemini-api/docs/flex-inference).

## Key Decisions

| Role | Model | Input / Output ($/1M) | Notes |
|------|-------|----------------------|-------|
| Tailor (production) | TBD after eval | — | Current: `deepseek/deepseek-v4-pro`. Re-evaluating. |
| Tailor controls | `anthropic/sonnet`, `anthropic/opus` | $3/$15, $5/$25 | Quality baseline and ceiling. Direct API only. |
| Extraction | `openrouter/openai/gpt-5.4-mini` | $0.375 / $2.25 (flex) | Proven at structured JSON. |
| Extraction (budget) | `deepseek/deepseek-v4-flash` | $0.098 / $0.197 | 5× cheaper. Test if reliable enough. |
| CV judges (primary) | `openrouter/google/gemini-3.1-pro-preview` | $1.00 / $6.00 (flex) | Strong nuance, cost-effective for input-heavy calls. |
| CV judges (alternate) | `openrouter/openai/gpt-5.4` | $1.25 / $7.50 (flex) | Rubric-faithful. Cross-validate rankings. |
| CV judges (stretch) | `deepseek/deepseek-v4-pro` | $0.435 / $0.87 | ~$0.018/call. Test if accurate enough for judging. |

**Rejected for judges:**
- **GPT-5.5** — $5/$30 per 1M; reserve for generator ceiling test, not routine judging.
- **Anthropic models** — known-good but we're testing whether non-Anthropic judges produce trustworthy rankings. Include Sonnet as judge control in the first run to calibrate, then drop if Gemini 3.1 Pro rankings correlate.

**Caveat — Gemini 3 Flash:** Headline $0.50/$3 pricing attractive, but thinking tokens (billed as output) can erode the cost advantage. Calibrate against 3.1 Pro before adopting for routine judging. *(Note: "March 2026 billing fix" claim from prior draft is unverified — verify via Langfuse `usage` on first flex eval run.)*

## Success Criteria

- Full eval run (`npx tsx scripts/eval-cv.ts`) completes without cross-provider JUDGE_MAP violations.
- Judge spend per run is materially lower than Sonnet-default baseline (track via Langfuse traces).
- Model rankings remain directionally trustworthy — if composite scores invert vs prior Sonnet-judged run, investigate before changing `TAILOR_MODEL`.
- Extraction gate passes (≥0.7) on all test JDs with Flash; if not, escalate extraction to V4 Pro.

## Scope Boundaries

**In scope:** `.env` / `.env.example` model string updates, `EVAL_JUDGE_MAP_JSON`, optional `eval-defaults.ts` default alignment after eval re-run confirms rankings.

**Out of scope:** Changing judge prompts, extraction schema, eval dimensions, or automated format compliance. Native batch APIs. Updating `CANDIDATE_GENERATION_MODELS` constant (separate code change if defaults should match).

## Task-Calibration Framework

Principle: **proportional quality gain expected?** If a cheaper tier passes the golden set on a dimension, do not promote to frontier for that task.

| Tier | Meaning | When to use |
|------|---------|-------------|
| **S** | Frontier necessary | Measured ≥2pt judge gap vs Tier A on golden set; or human dispute tie-breaker (≤5 cases) |
| **A** | Primary — best necessary quality/$ | Production default after calibration |
| **B** | Budget sufficient | Eval sweeps, schema tasks, extraction |
| **C** | Experiment | A/B discovery; promote to A only on measured win |
| **Avoid** | Overkill or unreliable | No proportional gain, or eval-invalid (free/unstable JSON) |

### Per-task tiers (June 2026)

| Task | A (primary) | B (budget) | C (try) | S (frontier, rare) | Avoid |
|------|-------------|------------|---------|-------------------|-------|
| **Tailor** | `deepseek/deepseek-v4-pro`, `openrouter/xiaomi/mimo-v2.5-pro`, `openrouter/qwen/qwen3.7-max` | `deepseek/deepseek-v4-flash`, `openrouter/minimax/minimax-m2.5`, `openrouter/xiaomi/mimo-v2.5` | `openrouter/minimax/minimax-m3`, `openrouter/moonshotai/kimi-k2.6`, `openrouter/z-ai/glm-5.1`, `openrouter/mistralai/mistral-large-2512` | `openrouter/openai/gpt-5.5`, `openrouter/google/gemini-3.1-pro-preview` (confirm only) | `:free` tiers, `openrouter/owl-alpha`, `openrouter/openai/gpt-5.5-pro` |
| **Extraction** | `openrouter/openai/gpt-5.4-mini`, `deepseek/deepseek-v4-flash`, `openrouter/openai/gpt-5.4-nano` | `openrouter/qwen/qwen3-235b-a22b-2507`, `openrouter/mistralai/mistral-small-2603`, `openrouter/google/gemini-3.1-flash-lite` | `openrouter/qwen/qwen3.7-plus`, `openrouter/minimax/minimax-m2.5` | — | Frontier pro tiers, `openrouter/owl-alpha` |
| **Extraction judge** | `openrouter/openai/gpt-5.4-mini`, `deepseek/deepseek-v4-flash`, `openrouter/openai/gpt-5.4-nano` | `openrouter/mistralai/mistral-small-2603`, `openrouter/qwen/qwen3-235b-a22b-2507` | `openrouter/nvidia/nemotron-3-super-120b-a12b` (paid) | — | All `:free` |
| **Relevance judge** | `openrouter/google/gemini-3.1-pro-preview`, `openrouter/openai/gpt-5.4`, `deepseek/deepseek-v4-pro` | `openrouter/google/gemini-3-flash-preview`, `openrouter/openai/gpt-5.4-mini`, `openrouter/qwen/qwen3.7-plus` | `openrouter/nvidia/nemotron-3-ultra-550b-a55b`, `openrouter/minimax/minimax-m3` | `openrouter/openai/gpt-5.5` (tie-break only) | `:free`, `openrouter/owl-alpha` |
| **Hallucination judge** | `openrouter/google/gemini-3.1-pro-preview`, `openrouter/openai/gpt-5.4`, `deepseek/deepseek-v4-pro` | `openrouter/openai/gpt-5.4-mini`, `openrouter/qwen/qwen3.7-max`, `openrouter/xiaomi/mimo-v2.5-pro` | `openrouter/mistralai/mistral-large-2512`, `openrouter/nvidia/nemotron-3-ultra-550b-a55b` | `openrouter/openai/gpt-5.5` (if fabrications missed) | `openrouter/xiaomi/mimo-v2.5` (weaker grounding), `:free` |
| **Eval generators** | Phase 1 field (see Requirements section) | `openrouter/qwen/qwen3.7-plus`, `openrouter/xiaomi/mimo-v2.5`, `openrouter/minimax/minimax-m2.5` | `openrouter/moonshotai/kimi-k2.6`, `openrouter/mistralai/mistral-large-2512`, `openrouter/z-ai/glm-5.1` | — | `openrouter/openai/gpt-5.5-pro`, `:free` |

**Niche highlights:** MiMo V2.5 Pro ($0.435/$0.87, 1M ctx) is the strongest DeepSeek challenger at the same price point. MiMo V2.5 base ($0.14/$0.28) is the budget alternative. Qwen3.7-Max ($1.25/$3.75) claims frontier-level — test against GPT-5.4. Qwen3-235B ($0.09/$0.10) for extraction only. `openrouter/owl-alpha` (free) disqualified for judges (54% structured-output errors reported; 20 RPM, no SLA on free tier).

**Experiment protocol:** 30–50 golden JD/CV/KB triples. Optimize: (1) hallucination gate, (2) relevance, (3) extraction schema validity, (4) cost. Phase 1: all Tier B/C generators × frozen Tier A judges. Phase 2: top 3 × cross-provider judge pairs. Phase 3: top 2 × full golden set + human spot-check (n=10). Promote C→A only on ≥2pt composite improvement with hallucination within 1% of incumbent.

## Alternatives to Try (experimentation queue)

Grouped by role; quality-first within DeepSeek / OpenAI / Google, then stretch options.

**Judges (input-heavy, cross-provider required):**
1. `openrouter/google/gemini-3.1-pro-preview` — default flex judge
2. `openrouter/openai/gpt-5.4` — rubric-faithful OpenAI flex judge
3. `openrouter/google/gemini-3-flash-preview` — budget flex; calibrate vs 3.1 Pro
4. `openrouter/google/gemini-2.5-pro` — mature; explicit `reasoning.max_tokens` budget
5. `deepseek/deepseek-v4-pro` — judge when generator is OpenAI/Google (~$0.018/call, no flex)
6. `openrouter/openai/gpt-5.5` — tie-breaker / golden-set only; thinking cost risk

**Extraction:**
7. `deepseek/deepseek-v4-flash` — default
8. `deepseek/deepseek-v4-pro` — if gate fails
9. `openrouter/openai/gpt-5.4-mini` — quality cross-check (flex)

**Generators / eval targets:**
10. `deepseek/deepseek-v4-pro` — production parity
11. `openrouter/google/gemini-3.1-pro-preview` — flex frontier benchmark
12. `openrouter/openai/gpt-5.4` — flex reference
13. `openrouter/openai/gpt-5.5` — quality ceiling test only

**Stretch (no flex, distinct provider for judge map diversity):**
14. `openrouter/qwen/qwen3.7-max` — Alibaba's best; claims frontier-level
15. `openrouter/mistralai/mistral-medium-3-5` — rubric adherence ($1.50/$7.50)
16. `openrouter/moonshotai/kimi-k2.6` — long-context agentic ($0.68/$3.41)

### Future: Multi-Pass Generation Experiment

**Hypothesis:** A cheaper model doing generate → self-critique → revise (3 passes) can beat a one-shot expensive model on quality. Example: DeepSeek V4 Pro looped 3× (~$0.006 total) vs one-shot Opus (~$0.15+). If the looped output scores higher, the economics are extremely favorable. This is inference-time compute arbitrage — spend more tokens on a cheaper model instead of fewer tokens on an expensive one.

**Protocol:** After Phase 1 identifies the top 2–3 generators, re-run the top budget model in a 3-pass loop (generate → judge with same model → revise) against one-shot Opus and Sonnet. Compare composite scores. This is Phase 4 — deferred until primary model selection is complete.

## Outstanding Questions

- After re-run with new judges, does `deepseek/deepseek-v4-pro` still win on composite score vs `anthropic/sonnet`? Prior eval (2026-06-03, Sonnet judges) ranked Sonnet first — judge swap may shift scores; treat as calibration check, not automatic tailor switch.
- How much do thinking tokens add per judge call with default vs minimal reasoning? Measure from Langfuse `usage` on first flex eval run.

## Recommended `.env` block

```
# Production (unchanged until eval re-run confirms winner)
TAILOR_MODEL=deepseek/deepseek-v4-pro

# Phase 1 generator field (9 candidates + 2 Anthropic controls)
EVAL_MODELS=deepseek/deepseek-v4-pro,openrouter/qwen/qwen3.7-max,openrouter/xiaomi/mimo-v2.5-pro,openrouter/minimax/minimax-m3,openrouter/google/gemini-3.1-pro-preview,openrouter/openai/gpt-5.4,openrouter/openai/gpt-5.5,anthropic/sonnet,anthropic/opus

# Judge defaults
EVAL_JUDGE_MODEL=openrouter/google/gemini-3.1-pro-preview

# Extraction (primary: GPT-5.4-mini; budget: DeepSeek Flash — switch after calibration)
EVAL_EXTRACTION_MODEL=openrouter/openai/gpt-5.4-mini

# Cross-provider judge map (generator → judge)
EVAL_JUDGE_MAP_JSON={"deepseek/deepseek-v4-pro":"openrouter/google/gemini-3.1-pro-preview","openrouter/qwen/qwen3.7-max":"openrouter/google/gemini-3.1-pro-preview","openrouter/xiaomi/mimo-v2.5-pro":"openrouter/google/gemini-3.1-pro-preview","openrouter/minimax/minimax-m3":"openrouter/google/gemini-3.1-pro-preview","anthropic/sonnet":"openrouter/openai/gpt-5.4","anthropic/opus":"openrouter/openai/gpt-5.4","openrouter/google/gemini-3.1-pro-preview":"openrouter/openai/gpt-5.4","openrouter/openai/gpt-5.4":"openrouter/google/gemini-3.1-pro-preview","openrouter/openai/gpt-5.5":"openrouter/google/gemini-3.1-pro-preview"}

EVAL_EXTRACTION_MIN_SCORE=0.7
```

**JUDGE_MAP notes:** Non-big-3 generators (Qwen, Xiaomi, MiniMax) all fall back to Gemini 3.1 Pro as judge — clean cross-provider. Anthropic generators use GPT-5.4. OpenAI/Google generators cross-judge each other.
