# Architecture

Architecture decisions, code conventions, module boundaries, and infrastructure choices for the CV Tailoring API.

- [Application walkthrough](./APP_WALKTHROUGH.md) — start-to-finish flow with file and function references
- [Model selection](./MODEL_SELECTION.md) — provider routing, model defaults, evaluation pipeline and results
- [Pipeline enhancements](./PIPELINE_ENHANCEMENTS.md) — two-pass pipeline, structured output, critic node, batch processing
- [Learning system](./LEARNING_SYSTEM.md) — feedback capture, hallucination memory, few-shot routing, persona evolution, drift detection
- [File layout](./FILE_LAYOUT.md) — canonical project tree, source of truth for module locations

---

## Stack context (for agents)

This project is the **CV Tailoring API plus inbox worker (in progress)** — a Next.js 15 backend deployed on Railway. `POST /api/tailor-cv` accepts a job description and returns a tailored CV as a base64-encoded `.docx` (plus curated JSON). The default `strict` path will also return recruiter reply email text (M8.1). Bearer auth (`TAILOR_API_KEY`); master CV is JSON via `MASTER_CV_JSON` / `MASTER_CV_PATH`; the LLM returns schema-validated curated JSON; the server mechanically builds `.docx`. No product UI. Gmail auth/list/body-extract/processed-id store are in this process; thread drafts (M8.5) are not shipped yet (product contract: `docs/plans/2026-09-05-002-feat-inbox-worker-plan.md`). A learning system with local SQLite storage is planned post-MVP.

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
| Deployment | Railway (Hobby) | Standard Node.js process (`railway.toml`). No function timeout ceiling. Not Vercel Edge / Fluid Compute. |
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
  │     └── fallback: hardcoded prompt in curator-prompt.ts
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
- **Word .docx output**: LLM produces schema-validated curated JSON; server mechanically builds `.docx` via the `docx` npm package. Returns as base64. Later inbox rows decode and attach to Gmail drafts (not shipped yet).
- **OpenRouter flex is transport- and vendor-gated, not a shared request-builder flag.** `ChatOptions.openRouterFlex` (default `OPENROUTER_FLEX_ENABLED=true`) is read only by `callOpenRouter`. Direct OpenAI/Google/Anthropic/DeepSeek wrappers ignore it — they never attach `service_tier`. On OpenRouter, `service_tier: flex` is attached only when the API model vendor is `openai` or `google`. OpenRouter **restricts routing to flex endpoints** when that field is set, so sending it on `openrouter/deepseek/…` (or Qwen/MiniMax/etc.) is not a no-op. Anthropic stays on the direct API (Message Batches deferred). There is no global always-flex setting and no provider fallback chain in `chat()`.
- **Provider/model namespace for all LLM routing**: Every model identifier is `provider/model`. The first `/`-delimited segment names the provider (`KNOWN_PROVIDERS`); the remainder is the model ID passed to that provider's API. No bare aliases (e.g. `sonnet`, `gpt-4o`) — `anthropic/sonnet` is a namespaced family alias resolved inside `callAnthropic`. Adding a **model** is an env/config change. Adding a **provider** still needs one `dispatchProvider` case plus an integration function (SDK call shape). Do not infer provider from model-name conventions.
- **Separate model**: CV generation uses `TAILOR_MODEL`; generic `chat()` defaults use `AI_MODEL`. There is no production chat-bot route yet.
- **Strict-path reply text**: Planned on the same curator pass (M8.1) — not implemented yet. Flexible `coverLetter` is unchanged and is not the commercial inbox path. Product contract: `docs/plans/2026-09-05-002-feat-inbox-worker-plan.md`.
- **Langfuse Prompt Management**: The curator system prompt lives in Langfuse (`cv-curator-json`, text type). At runtime, the app fetches the `production`-labeled version with 300s caching. A hardcoded fallback in `curator-prompt.ts` ensures availability if Langfuse is unreachable. Prompt updates are done programmatically via the Langfuse API/SDK — no UI-only workflows. Each LLM generation is linked to its prompt version via the native `prompt` attribute for tracing full version lineage.
- **Bearer auth**: `POST /api/tailor-cv` requires `Authorization: Bearer <TAILOR_API_KEY>`. Single-user shared secret; no sessions or accounts.

### Anti-patterns

- Do NOT fork the CV platform project. This project consumes the knowledge base directly from its own filesystem. Phase 2 will add a CV platform API integration.
- Do NOT add frontend pages or components. No product UI in v1; the inbox worker is not a UI.
- Do NOT add selective context retrieval in MVP. Inject everything.
- Do NOT edit the production curator prompt only in git (`curator-prompt.ts` fallback) and ship it — update Langfuse (`cv-curator-json`, `production` label) and keep the hardcoded fallback in sync. Legacy `cv-prompt.ts` is not the tailor hot path.
- Do NOT rely on Langfuse `latest` label in production — always use `production` label for deterministic prompt versioning.
- Do NOT build Anthropic/DeepSeek native batch processing inside the Next.js request path.
- Do NOT commit to a batch model before running structured evaluation against the 8-part framework.

## File layout

See [File layout reference](./FILE_LAYOUT.md).

## Constraints

- **No Vercel free tier**: Deployed on Railway (Hobby, no timeout ceiling). Vercel Hobby's 10s function timeout is too short for frontier LLM calls generating full CVs.
- **Knowledge base is read-only at runtime**: Files are read from disk, not mutated by the API.
- **Stateless (MVP)**: No application database. Rate limits and inbox processed-ids use Upstash Redis. Each tailor request is independent. Learning system (post-MVP) adds SQLite for feedback and few-shot storage — still ephemeral per-deployment, not a persistent multi-tenant database.
- **Environment variables only**: All secrets via env vars. No hardcoded keys. No config files with secrets.
