# Architecture

Architecture decisions, code conventions, module boundaries, and infrastructure choices for the CV Tailoring API.

- [Application walkthrough](./APP_WALKTHROUGH.md) — start-to-finish flow with file and function references
- [Model selection](./MODEL_SELECTION.md) — provider routing, model defaults, evaluation pipeline and results
- [Pipeline enhancements](./PIPELINE_ENHANCEMENTS.md) — two-pass pipeline, structured output, critic node; [inbox scan runtime](./PIPELINE_ENHANCEMENTS.md#inbox-scan-runtime) vs [deferred LLM batch APIs](./PIPELINE_ENHANCEMENTS.md#native-llm-batch-apis-deferred)
- [Learning system](./LEARNING_SYSTEM.md) — feedback capture, hallucination memory, few-shot routing, persona evolution, drift detection
- [File layout](./FILE_LAYOUT.md) — canonical project tree, source of truth for module locations

---

## Stack context (for agents)

This project is the **CV Tailoring API plus inbox worker (in progress)** — a Next.js 15 backend deployed on Railway. `POST /api/tailor-cv` accepts a job description and returns a tailored CV as a base64-encoded `.docx` (plus curated JSON). The default `strict` path returns recruiter reply email text. Bearer auth (`TAILOR_API_KEY`); master CV is JSON via `MASTER_CV_JSON` / `MASTER_CV_PATH`; the LLM returns schema-validated curated JSON; the server mechanically builds `.docx`. No product UI. Gmail auth/list/body-extract/processed-id store, thread drafts, and `npm run inbox:scan` are in this process (product contract: `docs/plans/2026-09-05-002-feat-inbox-worker-plan.md`). Railway cron for that scan (M8.6) is still planned. A learning system with local SQLite storage is planned post-MVP.

The project was cloned from `portfolio-react-ts` and stripped of all portfolio pages, components, and styles. Only the API layer and knowledge base were retained.

## Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Language | TypeScript 5 | Strict mode |
| Framework | Next.js 15 App Router | API routes only (`app/api/`). No pages, no components, no layout beyond API root. |
| Runtime | Node.js 22 LTS (≥22.0.0) | Railway (Nixpacks reads `.nvmrc`); no Edge Functions |
| LLM | OpenAI, Anthropic, Google, DeepSeek, OpenRouter (multi-provider dispatch) | Model strings use `provider/model`. Routing is `parseNamespacedProvider` + `KNOWN_PROVIDERS` (`lib/providers.ts`). `dispatchProvider` may `switch` on provider for SDK call shape — that is integration, not routing. OpenRouter `service_tier: flex` is attached only in `callOpenRouter`, and only for `openai/*` and `google/*` model IDs (OpenRouter flex **restricts** routing to flex endpoints; it is not silently ignored). Direct `openai/` and `google/` prefixes do not get flex. Anthropic is always the direct API. Separate `TAILOR_MODEL` for CV generation. Tailor is a single curator pass. Native batch APIs deferred. |
| Auth | Bearer shared-secret (`TAILOR_API_KEY`) | Required for `POST /api/tailor-cv` |
| Database | None on the tailor path (stateless). SQLite planned post-MVP for the learning system; PostgreSQL + pgvector later. | Do not treat SQLite as current storage. |
| Storage | None | CV .docx is generated in-memory per request, returned as base64 |
| Testing (unit) | node:test + node:assert/strict | Zero dependency, no config drift. Test-only injection via optional function parameters. Run: `npm test`. |
| Testing (E2E) | @playwright/test | HTTP-level API tests in `tests/e2e/`. Requires a running dev server (`npm run dev`). Run: `npm run test:e2e`. Set `RUN_E2E_LLM_TESTS=true` to include the full LLM call test. |
| Observability | LangFuse + LangSmith | Dual tracing on all LLM calls |
| Deployment | Railway (Hobby) | Default v1 host: long-lived Node (`npm start`). Vercel Hobby fluid functions default to and cap at 300s. See [Deployment hosting](./README.md#deployment-hosting-railway-vs-vercel). |
| Package manager | npm | |

> **Data Access Layer tests:** Not applicable in MVP (stateless, no database). DAL test coverage is deferred to the SQLite learning-system phase (post-MVP). See `docs/arch/LEARNING_SYSTEM.md` for the planned data model.

## Architecture

```text
POST /api/tailor-cv
  { jobDescription: string }

  ↓

buildTailorResponse (tailor-pipeline.ts) via tailor-cv/route.ts
  ├── parseClientIp (rightmost x-forwarded-for)
  ├── checkRateLimit (Upstash; before auth)
  ├── authenticate (Bearer TAILOR_API_KEY)
  ├── capped body read + validateTailorCvBody
  ├── requireMasterCv (MASTER_CV_JSON / MASTER_CV_PATH)
  ├── getCuratorPrompt()        → Langfuse ("cv-curator-json", label: production)
  │     └── fallback: hardcoded prompt in curator-prompt.ts when Langfuse is unset,
  │         the fetch fails, or the strict production text omits `reply_text`
  ├── applyCurationModePolicy + compileCuratorPrompt
  ├── chat(..., { model: getTailorModel(), langfusePrompt })
  ├── extractStructuredJson → validateCvJson → size cap
  ├── sanitize + buildJsonDocxBase64
  └── return { cv, curatedJson, builderVersion, ... }
```

See [Pipeline enhancements](./PIPELINE_ENHANCEMENTS.md) for the two-pass pipeline and batch processing designs.

### Key decisions

- **Master CV injection**: The canonical master CV JSON is injected into the curator prompt. No selective retrieval in MVP. Fine-grained RAG and metadata tagging are explicitly rejected in v1 to preserve architectural simplicity.
- **Multi-Tenant Road Map & Isolation (Future)**: When scaling to a multi-user model, user career data will remain strictly isolated at the level of private Markdown files (rather than shared database entries). Onboarding will utilize an automated ingestion pipeline featuring an "Onboarding Iceberg Principle"—extracting unpolished, under-the-radar scale, team size, budget, and impact metrics typically pruned from a single uploaded CV, converting them to high-fidelity Markdown blocks using an agentic conversation flow.
- **Word .docx output**: LLM produces schema-validated curated JSON; server mechanically builds `.docx` via the `docx` npm package. Returns as base64. The inbox worker decodes and attaches it to a Gmail reply draft.
- **OpenRouter flex is transport- and vendor-gated, not a shared request-builder flag.** `ChatOptions.openRouterFlex` (default `OPENROUTER_FLEX_ENABLED=true`) is read only by `callOpenRouter`. Direct OpenAI/Google/Anthropic/DeepSeek wrappers ignore it — they never attach `service_tier`. On OpenRouter, `service_tier: flex` is attached only when the API model vendor is `openai` or `google`. OpenRouter **restricts routing to flex endpoints** when that field is set, so sending it on `openrouter/deepseek/…` (or Qwen/MiniMax/etc.) is not a no-op. Anthropic stays on the direct API (Message Batches deferred). There is no global always-flex setting and no provider fallback chain in `chat()`.
- **Provider/model namespace for all LLM routing**: Every model identifier is `provider/model`. The first `/`-delimited segment names the provider (`KNOWN_PROVIDERS`); the remainder is the model ID passed to that provider's API. No bare aliases (e.g. `sonnet`, `gpt-4o`) — `anthropic/sonnet` is a namespaced family alias resolved inside `callAnthropic`. Adding a **model** is an env/config change. Adding a **provider** still needs one `dispatchProvider` case plus an integration function (SDK call shape). Do not infer provider from model-name conventions.
- **Separate model**: CV generation uses `TAILOR_MODEL`; generic `chat()` defaults use `AI_MODEL`. There is no production chat-bot route yet.
- **Strict-path reply text**: Successful `strict` tailor returns recruiter reply email text in the same curator pass as the Curated CV. Flexible `coverLetter` is unchanged and is not the commercial inbox path. Product contract: `docs/plans/2026-09-05-002-feat-inbox-worker-plan.md`.
- **Inbox scan runtime**: The Gmail inbox worker is **not** a separate service. `tailorLabeledMessage` calls `runTailorCore` in-process — no Bearer auth, no public rate-limit buckets, and no HTTP loop through `POST /api/tailor-cv`. `npm run inbox:scan` is the local/on-demand entrypoint; M8.6 is the Railway cron for that same job.
- **Langfuse Prompt Management**: The curator system prompt lives in Langfuse (`cv-curator-json`, text type). At runtime, the app fetches the `production`-labeled version with 300s caching. The hardcoded fallback in `curator-prompt.ts` is used when Langfuse is unset, the fetch fails, or a strict production prompt does not request `{ curated_cv, reply_text }` (a warning is logged; that fetch is traced as a fallback). Shipping a curator-contract change still requires publishing that prompt in the same release via `npx tsx scripts/create-langfuse-prompts.ts` (or the Langfuse API) with the `production` label, then recycling processes inside `LANGFUSE_CURATOR_PROMPT_CACHE_TTL_SECONDS` (default 300) so old instances do not keep validating the previous shape. Each LLM generation is linked to its prompt version via the native `prompt` attribute for tracing full version lineage.
- **Bearer auth**: `POST /api/tailor-cv` requires `Authorization: Bearer <TAILOR_API_KEY>`. Single-user shared secret; no sessions or accounts.

### Anti-patterns

- Do NOT fork the CV platform project. This project consumes the knowledge base directly from its own filesystem. Phase 2 will add a CV platform API integration.
- Do NOT add frontend pages or components. No product UI in v1; the inbox worker is not a UI.
- Do NOT add selective context retrieval in MVP. Inject everything.
- Do NOT edit the production curator prompt only in git (`curator-prompt.ts` fallback) and ship it — update Langfuse (`cv-curator-json`, `production` label) and keep the hardcoded fallback in sync. Legacy `cv-prompt.ts` is not the tailor hot path.
- Do NOT leave Langfuse `cv-curator-json` `production` on the previous shape (e.g. bare CV JSON) after a curator-contract release. New processes substitute the hardcoded fallback when that text omits `reply_text`, but processes still inside the prompt cache TTL keep serving whatever they already fetched. Publish via `scripts/create-langfuse-prompts.ts` in the same release and recycle those processes.
- Do NOT rely on Langfuse `latest` label in production — always use `production` label for deterministic prompt versioning.
- Do NOT route inbox scan through `POST /api/tailor-cv` or share its rate-limit buckets — inbox tailor is in-process (product contract R8).
- Do NOT block **user-facing** HTTP routes on native LLM batch submit/poll/retrieve loops. When built, batch steps belong on a cron/CLI path with durable batch-id state (Upstash or similar) between ticks — not on `POST /api/tailor-cv`. A cron-only route is allowed; do not run submit/poll/retrieve inside user-facing handlers.
- Do NOT commit to a batch LLM pricing tier before operator smoke review confirms the sync curator quality bar.

## File layout

See [File layout reference](./FILE_LAYOUT.md).

## Constraints

- **Knowledge base is read-only at runtime**: Files are read from disk, not mutated by the API.
- **Stateless (MVP)**: No application database. Rate limits and inbox processed-ids use Upstash Redis. Each tailor request is independent. Learning system (post-MVP) adds SQLite for feedback and few-shot storage — still ephemeral per-deployment, not a persistent multi-tenant database.
- **Environment variables only**: All secrets via env vars. No hardcoded keys. No config files with secrets.

## Deployment hosting (Railway vs Vercel)

**Default for v1: Railway (Hobby).** Not because batch polling requires a daemon — it does not — but because **today’s product paths wait on live LLM responses**.

| Workload | LLM pattern | Hosting fit |
|----------|-------------|---------------|
| `POST /api/tailor-cv`, smoke against prod | Sync `chat()` — hold the request until the full CV returns | **Fits under 300s only when the call finishes in time.** Vercel Hobby fluid functions default to and cap at 300s (not the old ~10s ceiling). A frontier call of several minutes can still hit that cap. |
| Inbox scan (`npm run inbox:scan`, planned M8.6 cron) | Sync `runTailorCore()` **per message**, serially in one job | One pass over several messages can exceed 300s. The CLI is on this tree; Railway cron is not. |
| Deferred native LLM batch (Anthropic Message Batches, etc.) | **Submit → poll status → retrieve** (short HTTP calls; minutes–hours between submit and completion) | **Cron-friendly** on Vercel or Railway once durable batch-id state exists between ticks. Does **not** require blocking on the model inside one request. |

**Why Railway stays the pragmatic v1 choice**

1. **Sync tailor is the core path** — HTTP API, smoke, and inbox all use live `chat()` today, not batch APIs.
2. **Same repo and library code** — web and cron share env vars and Upstash Redis for rate limits, inbox claims, and (later) batch job state. Railway cron (M8.6) is planned as its own cron service (`startCommand` `npm run inbox:scan`) alongside the long-lived web service, not a second product codebase.
3. **Vercel free does not remove LLM cost** — the dominant spend is inference, not hosting. Hobby's 300s cap is enough for a short sync call and not enough for a serial multi-message scan or a call that runs past five minutes.
4. **Local-first is valid until M8.6** — `npm run inbox:scan` and `npm run dev` need **$0 hosting** until unattended schedule matters. Railway is for “laptop closed” cron, not day-to-day dev.

**What batch polling changes (and what it does not)**

Older docs implied batch needed a process **sitting open** waiting for the model. Anthropic Message Batches work differently: submit a batch, store the `batch_id`, **poll periodically** (cron every N minutes), retrieve when `ended`. Each poll/submit/retrieve call is short — compatible with serverless **for that lane alone**.

That **does not** move sync tailor or inbox scan to Vercel free: those paths still await a full curator response inline. When batch is built, the poller could live on Vercel cron while sync API stays on Railway — but that is a **deferred** cost optimization, not v1, and splitting hosts adds ops surface for modest savings.

**Revisit hosting when:** batch replaces enough sync volume to matter; or sync calls and a full serial scan reliably finish under Hobby's 300s cap; or the product stays local-only and Railway is paused until M8.6.
