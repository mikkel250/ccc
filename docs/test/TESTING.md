# Testing reference

Testing guide for the CV Tailoring API. Update when new endpoints or test suites are added.

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| Node.js ≥22.0.0 | Same as production (Railway); `.nvmrc` present |
| `npm install` | From repo root |
| LLM API key | At least one provider from `.env.example` |
| Running server | Required for e2e and manual `curl` tests (not for `npm test`) |

## Environment setup

```bash
cp .env.example .env.local
```

At minimum, set one LLM provider key and a namespaced model:

```bash
ANTHROPIC_API_KEY=...
TAILOR_MODEL=anthropic/sonnet
```

All model identifiers use `provider/model` format (e.g. `anthropic/sonnet`, `openrouter/openai/gpt-4o`). Unnamespaced model names are rejected at startup.

**Env file gotcha:** Next.js dev (`npm run dev`) loads `.env.local`. The e2e script uses `dotenv` and reads `.env`. Keep keys in both or copy:

```bash
cp .env.local .env
```

## Start the server

```bash
npm run dev
# → http://localhost:3000
```

After changing `next.config.mjs` or `instrumentation.ts`, restart.

## Quick smoke checks

### Health

```bash
curl http://localhost:3000/api/hello
# → {"service":"cv-tailoring-api","status":"ok"}
```

### Validation (no LLM call)

```bash
# Malformed JSON → 400
curl -s -X POST http://localhost:3000/api/tailor-cv \
  -H "Content-Type: application/json" \
  -d 'bad'

# Missing jobDescription → 400
curl -s -X POST http://localhost:3000/api/tailor-cv \
  -H "Content-Type: application/json" \
  -d '{}'

# Empty jobDescription → 400
curl -s -X POST http://localhost:3000/api/tailor-cv \
  -H "Content-Type: application/json" \
  -d '{"jobDescription":""}'

# GET → 405
curl -s http://localhost:3000/api/tailor-cv
```

### Manual tailor (uses LLM + full knowledge base)

```bash
curl -s -X POST http://localhost:3000/api/tailor-cv \
  -H "Content-Type: application/json" \
  -d '{"jobDescription": "Senior React engineer. Requirements: TypeScript, React, Node."}' \
  | jq -r '.cv' | base64 -d > /tmp/tailored-cv.docx
```

Open `/tmp/tailored-cv.docx` in Word or Pages.

---

## Unit tests

Fast, no server, no API keys:

```bash
npm test
```

| File | Covers |
|------|--------|
| `tests/cv-prompt.test.ts` | CV prompt schema |
| `tests/cv-prompt-struan-fallback.test.ts` | Struan framework fallback text |
| `tests/env.test.ts` | Env var parsing, provider/model validation |
| `tests/errors.test.ts` | Typed error classes (`RateLimitError`, `ServiceError`) |
| `tests/eval-architecture-docs.test.ts` | Eval architecture doc cross-references |
| `tests/eval-cv.test.ts` | Eval pipeline orchestration (`runEvalCv`) |
| `tests/eval-extract.test.ts` | JD metadata extraction + `parseFailed` signaling |
| `tests/eval-format.test.ts` | Eval output formatting |
| `tests/eval-judge.test.ts` | LLM-as-Judge (extraction, relevance, hallucination) |
| `tests/eval-schema.test.ts` | Eval schema types, `JUDGE_MAP` config |
| `tests/eval-tailor-model-default.test.ts` | Tailor model default resolution |
| `tests/knowledge-base.test.ts` | KB fail-fast on missing/empty files |
| `tests/llm-chat-dispatch.test.ts` | Multi-provider `chat` dispatch |
| `tests/llm-config.test.ts` | LLM config resolution |
| `tests/llm-deepseek.test.ts` | DeepSeek provider integration |
| `tests/llm-model-defaults.test.ts` | Model default resolution |
| `tests/llm-openrouter.test.ts` | OpenRouter response shape and errors |
| `tests/llm-provider-detection.test.ts` | `detectProvider` routing |
| `tests/llm-test-connection.test.ts` | Provider connection tests |
| `tests/markdown-docx.test.ts` | Markdown → `.docx` conversion, ZIP bytes |
| `tests/rate-limit.test.ts` | Rate limit, burst detection, per-IP serialization |
| `tests/route.test.ts` | Route-level: JSON parse, IP parsing, typed error → HTTP |
| `tests/tailor-cv-validation.test.ts` | Request body validation |
| `tests/test-jds.test.ts` | Test JD fixtures |
| `tests/eslint-config.test.ts` | ESLint configuration |

---

## E2E tests

### Script-based (manual)

Script: [`scripts/e2e-tailor-cv.ts`](../scripts/e2e-tailor-cv.ts)

Hits a running server with sample JDs, checks for valid base64 `.docx`:

```bash
npx tsx scripts/e2e-tailor-cv.ts http://localhost:3000
# Or one sample at a time:
npx tsx scripts/e2e-tailor-cv.ts http://localhost:3000 ai-ml
```

### Playwright (automated)

```bash
npm run test:e2e
```

File: `tests/e2e/api.e2e.ts` — HTTP-level API tests via `@playwright/test`. Requires a running dev server. Set `RUN_E2E_LLM_TESTS=true` to include the full LLM call.

---

## Eval pipeline (offline)

The eval pipeline benchmarks CV generation quality across models without hitting the HTTP API:

```bash
npx tsx scripts/eval-cv.ts
```

Uses test JDs from `knowledge-base/test-jds/`. Produces `eval-results/scores.json` with extraction, relevance, and hallucination scores per JD × model pair. Judge parse failures are surfaced as warnings in output — check for `parseFailed: true` in scores before trusting them.

---

## Suggested test order (before a PR)

```bash
npm test                    # 1. Unit tests
npm run build               # 2. Production build
npm run lint                # 3. Lint
npm run dev                 # 4. Start server (separate terminal)
curl http://localhost:3000/api/hello   # 5. Health
npm run test:e2e            # 6. Playwright e2e
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `/api/hello` returns 500 HTML | OTEL/grpc bundled in dev | Restart dev server |
| **400** on tailor-cv | Malformed JSON or missing `jobDescription` | Check request body |
| **405** on tailor-cv | Wrong HTTP method | Use POST |
| **429** | Rate limit (app or provider) | Check `RATE_LIMIT_*`; wait or use new IP |
| **503** | KB file missing or unreadable | Check `knowledge-base/` has all 5 required files |
| **503** on 2nd/3rd e2e sample | Gemini per-minute token quota | Run samples in isolation; wait 45-60s between |
| Empty or invalid `.docx` | LLM output not markdown-shaped | Check server logs; inspect prompt |
| Langfuse traces missing | Wrong region or missing keys | Confirm `LANGFUSE_BASE_URL` matches project region |
| Build fails | Circular import or bad import path | Run `npm run build`; check import graph |
