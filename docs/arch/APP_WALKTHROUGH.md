# Application Walkthrough

Start-to-finish guide to how the CV Tailoring API works. For stack decisions and constraints, see [README](./README.md). For module locations, see [FILE_LAYOUT](./FILE_LAYOUT.md).

---

## What this app does

A **Next.js API-only backend** (no UI) that accepts a job description, curates structured CV JSON from a master JSON, mechanically renders Word, and returns both artifacts. CCC POSTs the JD with a Bearer secret, attaches the `.docx`, and may retain curated JSON for regen.

**Production entry point:** `POST /api/tailor-cv` → `app/api/tailor-cv/route.ts :: POST`

---

## High-level architecture

```text
Client (CCC / smoke CLI)
    │
    ▼ POST { jobDescription } + Authorization: Bearer
app/api/tailor-cv/route.ts
    ├── authenticateTailorRequest()   app/api/lib/tailor-auth.ts
    ├── checkRateLimit(ip, secret)    app/api/lib/rate-limit.ts  (before body parse)
    ├── validateTailorCvBody()        app/api/lib/tailor-cv-validation.ts
    ├── requireMasterCv()             app/api/lib/master-cv.ts
    ├── getCuratorPrompt() + compile  app/api/lib/curator-prompt.ts
    ├── chat()                        app/api/lib/llm.ts  (TAILOR_MODEL, source: tailor-cv-curator)
    │     ├── dispatchProvider()
    │     └── tracers (Langfuse content redacted)
    ├── extractStructuredJson()       app/api/lib/eval-parse.ts
    ├── validateCvJson()              app/api/lib/cv-schema.ts
    └── buildJsonDocxBase64()         app/api/lib/json-docx-builder.ts
    │
    ▼ 200 { cv, curatedJson, builderVersion, model, usage, remaining, resetTime }
```

---

## Production request flow (step by step)

### 1. HTTP ingress

| Step | File | Function | Notes |
|------|------|----------|-------|
| Route handler | `app/api/tailor-cv/route.ts` | `POST` | `runtime = "nodejs"` — Railway Fluid Compute, not Edge |
| Method guard | same | `GET` | Returns 405; only POST is supported |
| Health check | `app/api/hello/route.ts` | `GET` | `{ service, status: "ok" }` — deploy probes and `npm run smoke` |

The root page (`app/page.tsx :: Home`) calls `notFound()` — there is intentionally no frontend.

### 2. Parse and validate

| Step | File | Function |
|------|------|----------|
| Client identity | `route.ts` | Rightmost `x-forwarded-for` entry → `400` if unresolvable |
| JSON body | `route.ts` | `request.json()` |
| Validation | `app/api/lib/tailor-cv-validation.ts` | `validateTailorCvBody(body, fallbackSessionId)` |

**Contract:** `jobDescription` required non-empty string; `sessionId` optional (defaults to IP-based id). Failures → **400**.

### 3. Rate limiting

| Step | File | Function |
|------|------|----------|
| Burst limit | `app/api/lib/rate-limit.ts` | `checkRateLimit(sessionId, ip, secretBucketKey)` |

Upstash Redis dual sliding windows (`RATE_LIMIT_MAX` + `RATE_LIMIT_SECRET_MAX`). Secret bucket is checked first so secret exhaustion does not burn IP quota. Runs after auth/IP resolution and **before** body parse so invalid authorized floods still count. **Quota exhaustion → 429** with more-restrictive `remaining`/`resetTime`. **Redis / rate-limit service failure → 503**. Unresolvable IP → **400** before rate limiting.

### 4. Load master CV

| Step | File | Function |
|------|------|----------|
| Master load | `app/api/lib/master-cv.ts` | `requireMasterCv()` |

Resolves `MASTER_CV_JSON` (preferred) or `MASTER_CV_PATH` (non-world-readable), schema-validates with Ajv. Preloaded asynchronously at process startup (`preloadMasterCv`); request path serves the cache only. Failures → **503**. Markdown `knowledge-base/` is **not** the tailor source.

### 5. Curator system prompt

| Step | File | Function |
|------|------|----------|
| Fetch prompt | `app/api/lib/curator-prompt.ts` | `getCuratorPrompt()` |
| Compile | same | `compileCuratorPrompt(promptText, masterCv)` → `{ ok, systemPrompt }` (fails closed if `{{MASTER_CV_JSON}}` missing; `$`-safe inject) |
| User message | same | `buildCuratorUserMessage(jd)` — JD in per-request nonce-delimited data channel |

Langfuse prompt name: `cv-curator-json` (fallback hardcoded; page-count / visual QA stripped).

### 6. Curator LLM

| Step | File | Function |
|------|------|----------|
| Resolve model | `lib/env.ts` | `getTailorModel()` |
| Chat | `app/api/lib/llm.ts` | `chat(..., { source: "tailor-cv-curator" })` |

Provider dispatch and dual tracing unchanged. Langfuse/LangSmith content for tailor is redacted (R8b).

### 7. Validate curated JSON → mechanical DOCX

| Step | File | Function |
|------|------|----------|
| Parse | `app/api/lib/eval-parse.ts` | `extractStructuredJson` |
| Schema + size | `app/api/lib/cv-schema.ts` | `validateCvJson`, `assertCuratedJsonSize` |
| Build | `app/api/lib/json-docx-builder.ts` | `buildJsonDocxBase64` |

Parse/schema/builder failures → **422** with no dual artifacts. Success → `{ cv, curatedJson, builderVersion, ... }`.

### 8. Response and errors

**Success (200):** `{ cv, curatedJson, builderVersion, model, usage, remaining, resetTime }`

**Error mapping** (`route.ts :: mapErrorToResponse`, table-driven `ERROR_RESPONSES`):

| Condition | Status | Handler |
|-----------|--------|---------|
| Auth failure | 401 | before pipeline |
| Curator/schema/builder | 422 | client-safe; no dual artifacts |
| `RateLimitError` | 429 | forwards `error.message` |
| `ServiceError` | 503 | forwards `error.message` |
| LLM provider/quota errors | 503 | `isLlmServiceError(message)` → masked generic message |
| Other | 500 | generic internal error |

---

## Configuration layer

All runtime config flows through env vars parsed in `lib/env.ts`:

| Variable | Getter | Used by |
|----------|--------|---------|
| `TAILOR_MODEL` | `getTailorModel()` | Production CV generation |
| `AI_MODEL` | `getDefaultLlmModel()` | Default when `chat()` has no model override |
| `EVAL_*` | `getEvalModels()`, etc. | Offline eval pipeline only |
| `RATE_LIMIT_*` | read in `rate-limit.ts` | Burst limiter |
| Langfuse / LangSmith keys | init functions | Tracing (opt-in via `*_TRACING=true`) |

Canonical catalog: `.env.example`. Cross-file invariant: documented `TAILOR_MODEL` must match code default (tested in `tests/eval-tailor-model-default.test.ts`).

---

## Observability

| Layer | File | When it runs |
|-------|------|--------------|
| Langfuse generations | `app/api/lib/tracers/langfuse.ts :: record` via `recordLangfuseTrace` | Every `chat()` call when `LANGFUSE_TRACING=true`; awaited so flush completes |
| Langfuse OTEL | `app/api/lib/langfuse-otel.ts :: ensureLangfuseOtel` | Lazy start on first trace; `flushLangfuseTraces()` before response ends |
| LangSmith runs | `app/api/lib/tracers/langsmith.ts :: record` via `recordLangSmithTrace` | Every `chat()` when `LANGSMITH_TRACING=true`; fire-and-forget |
| Next.js hook | `instrumentation.ts :: register` | `ensureSecureStartup()` (R5d) + `preloadMasterCv()`; OTEL stays lazy |

Production curator generations link to Langfuse prompt `cv-curator-json` via `langfusePrompt` on `ChatOptions`. Prompt/response content is redacted for export (R8b).

---

## Smoke (manual live API — not CI)

```bash
npm run smoke -- http://localhost:3000 [optional-jd-path]
```

Loads master via the same `MASTER_CV_*` env as the server, POSTs with Bearer, asserts `.docx` + `curatedJson` + `builderVersion`, then always runs `scoreJsonGrounding` + `scoreJsonJdFit` (env mins `SMOKE_GROUNDING_MIN` / `SMOKE_JD_FIT_MIN`). Markdown generation eval is retired — use smoke only.

Local regen without LLM: `npm run regen-docx -- curated.json out.docx --builder-version=<BUILDER_VERSION>`.

---

## Legacy prompt modules (not on production tailor path)

Prompt files cloned from the portfolio chat bot remain for a hypothetical future `/api/chat` route. Dead RAG helpers (`input-filter.ts`, `getRelevantContext`, chat-prompt model variants) were removed — recoverable from git history if needed.

- `chat-prompt.ts`, `jd-prompt.ts`, `prompts.ts`, `langfuse-prompts.ts`

---

## Scripts and verification

| Script | Entry | Verifies |
|--------|-------|----------|
| `npm run smoke` (`scripts/e2e-tailor-cv.ts`) | `main()` | Live tailor + dual artifacts + JSON judges |
| `npm run regen-docx` | CLI | Mechanical rebuild from curated JSON |
| `scripts/verify-rate-limit.ts` | `main()` | Live Upstash rate-limit behavior |
| `npm run test:e2e` | Playwright | HTTP auth/validation (optional LLM gated) |
| `scripts/create-langfuse-prompts.ts` | `main()` | Langfuse prompt upload |
| `npm test` | `tests/**/*.test.ts` | Unit + cross-file contracts |

---

## Planned but not implemented

See [PIPELINE_ENHANCEMENTS](./PIPELINE_ENHANCEMENTS.md) (two-pass, critic) and [LEARNING_SYSTEM](./LEARNING_SYSTEM.md) (SQLite feedback). Also deferred: recruiter reply draft, selective RAG.
