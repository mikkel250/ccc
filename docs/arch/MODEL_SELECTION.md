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

**Deferred:** LLM-as-Judge scoring; Anthropic Message Batches API (async submit/poll/retrieve).

## Provider strategy

OpenAI and Google models go through OpenRouter flex (`service_tier: flex`, overridable via `openRouterFlex: false`). DeepSeek and Anthropic use direct native APIs (`DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`). All models are namespaced `provider/model` — the provider segment determines routing; there are no special-cased bare aliases.

- Default `chat()` model: `deepseek/deepseek-v4-pro`
- CV generation uses a separate model (`TAILOR_MODEL` env var)
- Native batch APIs (Anthropic Message Batches, DeepSeek batch) are deferred — require async poll infrastructure

## Evaluation

Evaluation planned (post-MVP): Run models against 2–3 real JDs, score on hallucination rate, 8-part format compliance, and accomplishment relevance. Langfuse eval framework. No final CV production model committed until results are in.

No final CV production model committed until results are in.
