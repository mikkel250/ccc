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

### Evaluation pipeline

Live quality for the JSON curator pipeline is **`npm run smoke`** (Bearer + dual artifacts + grounding/JD-fit judges). Historical markdown generation eval artifacts remain under `eval-results/`; judge helpers live in `app/api/lib/eval-*.ts`. Test JDs are raw, unstructured recruiter text in `knowledge-base/test-jds/` (no YAML frontmatter).

**Complete (MVP):** LLM-as-Judge evaluation pipeline — two-stage judging with JD extraction gate, automated format compliance, relevance and hallucination judges. Scores pushed to Langfuse; artifacts saved to `eval-results/<jd-slug>/`.

**Two-stage flow:**

**Stage 1 — JD extraction gate (per JD, cached):**

1. **JD extraction** — `extractJdMetadata()` in `eval-extract.ts` calls an LLM to produce structured `JdExtraction` (requirements, keyword bank, hiring context, role type, implicit success signals).
2. **Extraction judge** — `scoreExtraction()` in `eval-judge.ts` scores completeness/accuracy against raw JD (0.0–1.0). Extraction is cached per JD slug for the run duration (in-memory `Map`). If score < `EVAL_EXTRACTION_MIN_SCORE` (default 0.7), all model evaluations for that JD are skipped with a warning.

**Stage 2 — CV generation and scoring (per JD×model pair):**

1. **Format compliance** (automated) — `scoreFormatCompliance()` in `eval-format.ts` checks the 8-part Struan structure (0.0–1.0).
2. **Accomplishment relevance** (LLM-as-Judge) — cross-provider judge scores alignment of Relevant Accomplishments against verified structured extraction (1–5).
3. **Hallucination rate** (LLM-as-Judge) — cross-provider judge cross-references claims against knowledge base ground truth; extraction provides JD context (0.0–1.0).

Scores are pushed to Langfuse via `@langfuse/client` (`langfuse.score.create()`) on all four dimensions. Artifacts:

- `eval-results/<jd-slug>/extraction.json` — JD-level structured extraction + extraction score
- `eval-results/<jd-slug>/<model>/raw-cv.md` — generated CV markdown
- `eval-results/<jd-slug>/<model>/scores.json` — all four dimension scores + metadata
- `eval-results/<jd-slug>/<model>/usage.json` — token counts, latency, and resolved model id (cost and usage analytics are tracked in Langfuse, not duplicated here)

Schema and judge prompts live in `app/api/lib/eval-schema.ts` (`JUDGE_MAP` defaults in code; optional `EVAL_JUDGE_MAP_JSON` overrides). Extraction in `eval-extract.ts`. Judge scorers in `eval-judge.ts`. Traces are flushed before script exit.

**Future gating (deferred):** When stage 1 extraction is consistently high-confidence, the extraction judge can be skipped or sampled.

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
