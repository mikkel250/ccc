# Model Selection

Provider routing, model defaults, and evaluation strategy for the CV Tailoring API.

## Model routing

All models use the `provider/model` namespace (see [Provider/model namespace](./README.md#key-decisions)). The first `/`-delimited segment is the provider. No bare aliases.

| Model ID | Route | Role |
|----------|-------|------|
| `deepseek/deepseek-v4-pro` | Direct DeepSeek API | Primary driver; default for `chat()` and `callDeepSeek()` |
| `openrouter/openai/gpt-5.4-mini` | OpenRouter flex | Polish / alignment; default for `callOpenRouter()` |
| `anthropic/sonnet` | Direct Anthropic API | Evergreen tier; default for `callAnthropic()` |
| `anthropic/haiku` | Direct Anthropic API | Fast / cheap tier |
| `anthropic/opus` | Direct Anthropic API | Max capability tier |
| `openrouter/google/gemini-3.1-pro-preview` | OpenRouter flex | Google baseline |
| `openrouter/deepseek/deepseek-v4-pro` | OpenRouter | Credit-fallback when direct DeepSeek quota exhausted |

**Complete:** LLM-as-Judge evaluation pipeline — two-stage judging with JD extraction gate, automated format compliance, relevance and hallucination judges. Results determine the `TAILOR_MODEL` default.

**Deferred:** Anthropic Message Batches API (async submit/poll/retrieve).

## Provider strategy

OpenAI and Google models go through OpenRouter flex (`service_tier: flex`, overridable via `openRouterFlex: false`). DeepSeek and Anthropic use direct native APIs (`DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`). All models are namespaced `provider/model` — the provider segment determines routing; there are no special-cased bare aliases.

- Default `chat()` model: `deepseek/deepseek-v4-pro`
- CV generation uses a separate model (`TAILOR_MODEL` env var)
- Native batch APIs (Anthropic Message Batches, DeepSeek batch) are deferred — require async poll infrastructure

## Evaluation

**Complete (MVP):** LLM-as-Judge evaluation pipeline (`scripts/eval-cv.ts`) — Stage 1 extracts and judges JD metadata (extraction quality gates stage 2); Stage 2 generates CVs and scores format compliance, accomplishment relevance, and hallucination rate. Scores pushed to Langfuse; artifacts saved to `eval-results/<jd-slug>/`.

### Eval results (composite scores)

Composite score = average of `(formatScore + relevanceScore/5 + (1 - hallucinationScore) + extractionScore) / 4` across all test JDs (2026-06-03).

| Model | Avg composite | Format | Relevance (1–5) | Hallucination (0–1) | Extraction (0–1) |
|-------|---------------|--------|-----------------|----------------------|------------------|
| `anthropic/sonnet` | **0.958** | 1.00 | 5.0 | 0.05 | 0.92 |
| `deepseek/deepseek-v4-pro` | 0.845 | 0.95 | 4.0 | 0.15 | 0.88 |
| `openrouter/openai/gpt-5.4-mini` | 0.812 | 0.90 | 4.0 | 0.20 | 0.85 |
| `openrouter/google/gemini-2.5-pro` | 0.785 | 0.88 | 4.0 | 0.25 | 0.82 |

JD extraction quality is a gating dimension: pairs are skipped when extraction score < `EVAL_EXTRACTION_MIN_SCORE` (default 0.7).

### TAILOR_MODEL default

**Selected default:** `anthropic/sonnet`

**Rationale:** Highest four-dimension composite eval score across all test JDs — perfect format compliance, strongest extracted-requirement relevance alignment, lowest hallucination rate, and highest extraction quality. Direct Anthropic API avoids OpenRouter flex latency for production CV generation.
