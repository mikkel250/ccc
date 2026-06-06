# Application Walkthrough

Start-to-finish guide to how the CV Tailoring API works. For stack decisions and constraints, see [README](./README.md). For module locations, see [FILE_LAYOUT](./FILE_LAYOUT.md).

---

## What this app does

A **Next.js API-only backend** (no UI) that accepts a job description and returns a tailored CV as a base64-encoded Word document. A separate consumer app (CCC) POSTs the JD, decodes the `.docx`, and attaches it to Gmail drafts.

**Production entry point:** `POST /api/tailor-cv` → `app/api/tailor-cv/route.ts :: POST`

---

## High-level architecture

```text
Client (CCC)
    │
    ▼ POST { jobDescription, sessionId? }
app/api/tailor-cv/route.ts
    ├── validateTailorCvBody()     app/api/lib/tailor-cv-validation.ts
    ├── checkRateLimit()           app/api/lib/rate-limit.ts
    ├── getAllContext()            app/api/lib/knowledge-base.ts
    ├── getCvPrompt() + compileCvPrompt()   app/api/lib/cv-prompt.ts
    ├── chat()                     app/api/lib/llm.ts  (model: TAILOR_MODEL)
    │     ├── dispatchProvider()   → OpenAI / Anthropic / Google / OpenRouter / DeepSeek
    │     ├── traceLLMCall()       app/api/lib/langsmith.ts
    │     └── traceLLMCall()       app/api/lib/langfuse.ts (+ langfuse-otel.ts)
    └── markdownToDocxBase64()   app/api/lib/markdown-docx.ts
    │
    ▼ 200 { cv, model, usage, remaining, resetTime }
Client decodes base64 → .docx attachment
```

---

## Production request flow (step by step)

### 1. HTTP ingress

| Step | File | Function | Notes |
|------|------|----------|-------|
| Route handler | `app/api/tailor-cv/route.ts` | `POST` | `runtime = "nodejs"` — Railway Fluid Compute, not Edge |
| Method guard | same | `GET` | Returns 405; only POST is supported |
| Health check | `app/api/hello/route.ts` | `GET` | `{ service, status: "ok" }` — used by deploy probes and `scripts/e2e-tailor-cv.ts` |

The root page (`app/page.tsx :: Home`) calls `notFound()` — there is intentionally no frontend.

### 2. Parse and validate

| Step | File | Function |
|------|------|----------|
| JSON body | `route.ts` | `request.json()` |
| Client identity | `route.ts` | `x-forwarded-for` or `x-real-ip` → fallback session `ip:{address}` |
| Validation | `app/api/lib/tailor-cv-validation.ts` | `validateTailorCvBody(body, fallbackSessionId)` |

**Contract:** `jobDescription` required non-empty string; `sessionId` optional (defaults to IP-based id). Failures → **400**.

### 3. Rate limiting

| Step | File | Function |
|------|------|----------|
| Burst limit | `app/api/lib/rate-limit.ts` | `checkRateLimit(sessionId, ipAddress)` |

In-memory IP burst detection (`RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW`). Not per-session persistence — protects the LLM from hammering. Failures → **429** with `remaining` and `resetTime`.

### 4. Load candidate context

| Step | File | Function |
|------|------|----------|
| Full KB injection | `app/api/lib/knowledge-base.ts` | `getAllContext()` |

Reads all five markdown files from `knowledge-base/` (`experience.md`, `projects.md`, `skills.md`, `career-story.md`, `meta-project.md`), joins with `\n\n--\n\n`. **MVP injects everything** (~50–60k tokens) — no RAG at runtime.

`getRelevantContext(query)` in the same file implements keyword-based selective retrieval for the **legacy chat bot**; tailor-cv does not call it.

### 5. Build the system prompt

| Step | File | Function |
|------|------|----------|
| Fetch prompt | `app/api/lib/cv-prompt.ts` | `getCvPrompt()` |
| Compile | same | `compileCvPrompt(promptText, context)` |

`getCvPrompt()` fetches Langfuse prompt `cv-tailor-system` with label **`production`** (300s cache). On failure, falls back to `getCvPromptFallbackText()` — the hardcoded Struan 8-part prompt (must stay in sync manually).

`compileCvPrompt()` substitutes `{CONTEXT}` / `{{CONTEXT}}` with the full knowledge base. Output format is defined in `docs/struan-8-part-cv-framework.md`.

### 6. LLM generation

| Step | File | Function |
|------|------|----------|
| Resolve model | `lib/env.ts` | `getTailorModel()` → `TAILOR_MODEL` env (default `anthropic/sonnet`) |
| User message | `route.ts` | `"Tailor a CV for this job description:\n\n{jd}"` |
| Chat | `app/api/lib/llm.ts` | `chat(messages, systemPrompt, options)` |

**Inside `chat()`:**

1. `detectProvider(model)` — first `/` segment must be a known provider (`openai`, `anthropic`, `google`, `openrouter`, `deepseek`).
2. `dispatchProvider(provider, ...)` — strips provider prefix, calls the integration function.
3. Dual tracing on success and failure (LangSmith + Langfuse).

Provider integrations live in `llm.ts`: `callOpenAI`, `callOpenRouter` (optional `service_tier: flex`), `callAnthropic` (alias resolution via `config/anthropic-models.json` + Models API cache), `callGoogle`, `callDeepSeek`.

All tunables come from `lib/env.ts :: getLLMConfig()` (`AI_TEMPERATURE`, `AI_MAX_TOKENS`, `OPENROUTER_FLEX_ENABLED`).

### 7. Markdown → DOCX

| Step | File | Function |
|------|------|----------|
| Convert | `app/api/lib/markdown-docx.ts` | `markdownToDocxBase64(markdown)` |
| Parse | same | `markdownToParagraphs()` — `#`/`##`/`###` headings, bullets, `**bold**` |

Returns base64 Office Open XML. `isValidDocxBase64()` checks ZIP magic bytes (`0x50 0x4B`) — used by e2e script.

### 8. Response and errors

**Success (200):** `{ cv, model, usage, remaining, resetTime }`

**Error mapping** (`route.ts` catch block):

| Condition | Status | Handler |
|-----------|--------|---------|
| Provider/quota errors | 503 | `isLlmServiceError(message)` in `llm.ts` |
| Provider rate limit | 429 | message contains `"Rate limit"` |
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
| Langfuse generations | `app/api/lib/langfuse.ts :: traceLLMCall` | Every `chat()` call when `LANGFUSE_TRACING=true` |
| Langfuse OTEL | `app/api/lib/langfuse-otel.ts :: ensureLangfuseOtel` | Lazy start on first trace; `flushLangfuseTraces()` before response ends |
| LangSmith runs | `app/api/lib/langsmith.ts :: traceLLMCall` | Every `chat()` when `LANGSMITH_TRACING=true` |
| Next.js hook | `instrumentation.ts :: register` | No-op — OTEL cannot load at build time |

Production CV generations link to the Langfuse prompt version via `langfusePrompt` on `ChatOptions` (set in `route.ts` from `getCvPrompt()`).

---

## Offline eval pipeline (not HTTP)

Used to compare candidate models before choosing `TAILOR_MODEL`. Run: `npx tsx scripts/eval-cv.ts`.

```text
scripts/eval-cv.ts :: runEvalCv()
  │
  ├─ Stage 1 (per JD, cached)
  │    extractJdMetadata()     app/api/lib/eval-extract.ts  → chat() with EVAL_EXTRACTION_MODEL
  │    scoreExtraction()        app/api/lib/eval-judge.ts    → gate if score < EVAL_EXTRACTION_MIN_SCORE
  │    write eval-results/<slug>/extraction.json
  │
  └─ Stage 2 (per JD × model)
       compileCvPrompt(getCvPromptFallbackText(), getAllContext())
       chat() with each EVAL_MODELS entry
       scoreFormatCompliance()  app/api/lib/eval-format.ts   — sync 8-part checker
       scoreRelevance()         app/api/lib/eval-judge.ts    — LLM judge
       scoreHallucination()     app/api/lib/eval-judge.ts    — LLM judge
       write eval-results/<slug>/<provider>/<model>/{raw-cv.md,scores.json,usage.json}
       push scores to Langfuse
```

Types, judge prompts, and `JUDGE_MAP` (cross-provider judge routing): `app/api/lib/eval-schema.ts`.

Test JD fixtures: `knowledge-base/test-jds/*.md`. Mock artifacts for CI: `scripts/seed-eval-results.ts`.

---

## Legacy modules (not on production path)

Cloned from the portfolio chat bot — prompts exist, no HTTP routes today:

- `chat-prompt.ts`, `jd-prompt.ts`, `prompts.ts`, `langfuse-prompts.ts` → future `/api/chat`
- `lib/input-filter.ts` → client-side short-circuits before chat API calls
- `knowledge-base.ts :: getRelevantContext()` → keyword RAG for chat (unused by tailor-cv)

---

## Scripts and verification

| Script | Entry | Verifies |
|--------|-------|----------|
| `scripts/e2e-tailor-cv.ts` | `main()` | Live hello + tailor-cv; docx magic bytes |
| `scripts/create-langfuse-prompts.ts` | `main()` | Langfuse prompt upload |
| `npm test` | `tests/**/*.test.ts` | Unit + cross-file contracts |

---

## Planned but not implemented

See [PIPELINE_ENHANCEMENTS](./PIPELINE_ENHANCEMENTS.md) (two-pass, critic) and [LEARNING_SYSTEM](./LEARNING_SYSTEM.md) (SQLite feedback). Also deferred: recruiter reply draft, selective RAG.
