# Testing reference

Testing guide for the CV Tailoring API. Update when new endpoints or test suites are added.

## Process: TDD

This project uses test-driven development for new behavior and bug fixes. Canonical agent rules live in `AGENTS.md` (Testing Philosophy).

1. **Red** — write a failing `tests/*.test.ts` case; confirm failure reason.
2. **Green** — minimal implementation to pass.
3. **Refactor** — clean up with the suite still green.

`npm test` is the red/green loop. Smoke and Playwright are post-green verification, not a substitute for the failing unit test.

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

### Manual tailor (uses LLM + master JSON)

Prefer smoke (includes judges). Ad-hoc curl:

```bash
curl -s -X POST http://localhost:3000/api/tailor-cv \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TAILOR_API_KEY" \
  -d '{"jobDescription": "Senior React engineer. Requirements: TypeScript, React, Node."}' \
  | jq -r '.cv' | base64 -d > /tmp/tailored-cv.docx
```

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
| `tests/eval-cv.test.ts` | Retired eval-cv CLI points to smoke |
| `tests/smoke-helpers.test.ts` | Smoke judge gates + redaction |
| `tests/json-docx-builder.test.ts` | JSON→docx builder + regen CLI |
| `tests/curator-prompt.test.ts` | Curator prompt contract |
| `tests/knowledge-base.test.ts` | Legacy KB helpers (not tailor hot path) |
| `tests/rate-limit.test.ts` | Dual IP + secret rate limits |
| `tests/route.test.ts` | Auth, curator cutover, dual response |
| `tests/tailor-cv-validation.test.ts` | Request body + JD size validation |

---

## Smoke (manual live API — not in `npm test` / CI)

```bash
npm run smoke -- http://localhost:3000
# optional JD override:
npm run smoke -- http://localhost:3000 path/to/jd.md
```

Requires running server, `TAILOR_API_KEY`, `MASTER_CV_*`, judge model keys. Asserts dual artifacts and always runs grounding + JD-fit judges (hard fail on `parseFailed` or scores below `SMOKE_*_MIN`).

Mechanical regen (no LLM):

```bash
npm run regen-docx -- curated.json out.docx --builder-version=1.0.0
```

### Playwright (automated HTTP)

```bash
npm run test:e2e
```

Bearer required. Optional LLM path gated by `RUN_E2E_LLM_TESTS=true`.

---

## Retired: markdown eval-cv

`scripts/eval-cv.ts` exits with a pointer to `npm run smoke`. Do not use it for live quality.

---

## Suggested test order (before a PR)

```bash
npm test                    # 1. Unit tests (no live smoke LLM)
npm run build               # 2. Production build
npm run lint                # 3. Lint
npm run dev                 # 4. Start server (separate terminal)
curl http://localhost:3000/api/hello   # 5. Health
npm run smoke -- http://localhost:3000 # 6. Live dual artifacts + judges
npm run test:e2e            # 7. Playwright HTTP
```

When leaving local-only: coordinate CCC `Authorization: Bearer` with this API cutover. Rotate `TAILOR_API_KEY` on suspected leak (API + CCC together).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `/api/hello` returns 500 HTML | OTEL/grpc bundled in dev | Restart dev server |
| **401** on tailor-cv | Missing/wrong Bearer | Set `Authorization: Bearer $TAILOR_API_KEY` |
| **400** on tailor-cv | Malformed JSON, oversize body/JD, or missing IP | Check body + `x-forwarded-for` |
| **405** on tailor-cv | Wrong HTTP method | Use POST |
| **422** | Curator JSON/schema/builder failure | Inspect server logs (no PII payloads); retry |
| **429** | Dual rate limit | Check `RATE_LIMIT_MAX` / `RATE_LIMIT_SECRET_MAX` |
| **503** | Master CV unavailable / Redis / LLM | Check `MASTER_CV_*`, Upstash, provider keys |
| Empty or invalid `.docx` | Builder or curator failure | Prefer `npm run smoke`; check `builderVersion` |
| Langfuse shows raw master/curated | Redaction not applied | Confirm tailor uses redacting tracer path (R8b) |
