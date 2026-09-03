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

**Complete:** Live JSON quality via `npm run smoke` (dual artifacts; operator reviews the files). Historical markdown-era composites informed the initial `TAILOR_MODEL` default.

**Deferred:** Anthropic Message Batches API (async submit/poll/retrieve). Do not build batch inside Next.js.

## Provider strategy

OpenAI and Google models go through OpenRouter flex (`service_tier: flex`, overridable via `openRouterFlex: false`). DeepSeek and Anthropic use direct native APIs (`DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`). All models are namespaced `provider/model` — the provider segment determines routing; there are no special-cased bare aliases.

- Default `chat()` model: `deepseek/deepseek-v4-pro`
- CV generation uses a separate model (`TAILOR_MODEL` env var)
- Optional `TAILOR_REASONING_EFFORT` pins thinking/reasoning for tailor-cv (unset = provider defaults). OpenRouter models get `reasoning.effort`; DeepSeek direct maps to `thinking` + `reasoning_effort` (see `.env.example`). Provider defaults differ sharply (e.g. Gemini 3.1 Pro mandatory medium; GPT-5.4 reasoning off by default; DeepSeek V4 Pro thinking high by default) — pin for fair model A/B.
- Native batch APIs (Anthropic Message Batches, DeepSeek batch) are deferred — require async poll infrastructure

## Evaluation

### Live quality (current)

Live quality for the JSON curator pipeline is **`npm run smoke`** (not part of `npm test` / CI):

1. Hit a running server with Bearer auth (`TAILOR_API_KEY`) and a JD (default or path override).
2. Assert dual artifacts: base64 `.docx` (`cv`) + schema-valid `curatedJson` + `builderVersion`.
3. Write redact-by-default files under `tmp/smoke/`. Optional `--flexible` / `SMOKE_CURATION_MODE=flexible` selects curation posture and may write a cover-letter DOCX.
4. Exit 0 if health, tailor, schema, and docx succeed. There is no grounding/JD-fit score gate and no judge model call.

Artifacts: `<jd-slug>.docx` + `<jd-slug>.curated.json` named from the JD basename. Test JDs are raw recruiter text in `knowledge-base/test-jds/` (no YAML frontmatter). Operator review of those files is the quality signal.

### Historical model-selection eval (markdown era)

The composite scores below come from the pre-cutover markdown CV eval (format / relevance / hallucination / extraction). That workflow is **retired** for day-to-day quality; keep the numbers only as rationale for the current `TAILOR_MODEL` default. Legacy score artifacts may still exist under `eval-results/`.

| Model | Avg composite | Format | Relevance (1–5) | Hallucination (0–1) | Extraction (0–1) |
|-------|---------------|--------|-----------------|----------------------|------------------|
| `anthropic/sonnet` | **0.958** | 1.00 | 5.0 | 0.05 | 0.92 |
| `deepseek/deepseek-v4-pro` | 0.845 | 0.95 | 4.0 | 0.15 | 0.88 |
| `openrouter/openai/gpt-5.4-mini` | 0.812 | 0.90 | 4.0 | 0.20 | 0.85 |
| `openrouter/google/gemini-2.5-pro` | 0.785 | 0.88 | 4.0 | 0.25 | 0.82 |

Composite (historical) = average of `(formatScore + relevanceScore/5 + (1 - hallucinationScore) + extractionScore) / 4` across test JDs (2026-06-03).

### TAILOR_MODEL default

**Selected default:** `anthropic/sonnet`

**Rationale:** Highest historical four-dimension composite across test JDs under the retired markdown eval — strong format compliance, requirement relevance, low hallucination, and extraction quality. Direct Anthropic API avoids OpenRouter flex latency for production CV generation. Re-validate with `npm run smoke` when changing the default.
