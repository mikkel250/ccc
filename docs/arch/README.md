# Architecture

Architecture decisions, code conventions, module boundaries, and infrastructure choices for the CV Tailoring API.

- [Application walkthrough](./APP_WALKTHROUGH.md) — start-to-finish flow with file and function references
- [Model selection](./MODEL_SELECTION.md) — provider routing, model defaults, evaluation pipeline and results
- [Pipeline enhancements](./PIPELINE_ENHANCEMENTS.md) — two-pass pipeline, structured output, critic node, batch processing
- [Learning system](./LEARNING_SYSTEM.md) — feedback capture, hallucination memory, few-shot routing, persona evolution, drift detection
- [File layout](./FILE_LAYOUT.md) — canonical project tree, source of truth for module locations

---

## Stack context (for agents)

This project is the **CV Tailoring API** — a lightweight Next.js 15 backend that will be deployed on Railway. It exposes a single endpoint (`POST /api/tailor-cv`) that accepts a job description and returns a tailored CV as a base64-encoded `.docx` file. Bearer auth (`TAILOR_API_KEY`); master CV is JSON via `MASTER_CV_JSON` / `MASTER_CV_PATH`; the LLM returns schema-validated curated JSON; the server mechanically builds `.docx`. No frontend. A learning system with local SQLite storage is planned post-MVP.

The project was cloned from `portfolio-react-ts` and stripped of all portfolio pages, components, and styles. Only the API layer and knowledge base were retained.

## Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Language | TypeScript 5 | Strict mode |
| Framework | Next.js 15 App Router | API routes only (`app/api/`). No pages, no components, no layout beyond API root. |
| Runtime | Node.js 22 LTS (≥22.0.0) | Railway (Nixpacks reads `.nvmrc`); no Edge Functions |
| LLM | OpenAI, Anthropic, Google, DeepSeek, OpenRouter (multi-provider dispatch) | Model strings use `provider/model` namespace. No bare aliases. Provider detection is a config lookup, not an `if` chain. OpenRouter supports `service_tier: flex` (discounted, latency-tolerant) for OpenAI/Google models; Anthropic batch processing requires direct API. Separate `TAILOR_MODEL` for CV generation. Tailor is a single curator pass; live quality is `npm run smoke` artifacts plus operator review. Native batch APIs deferred. |
| Auth | Bearer shared-secret (`TAILOR_API_KEY`) | Required for `POST /api/tailor-cv` |
| Database | SQLite (MVP), PostgreSQL + pgvector (future) | Learning system stores feedback, few-shot examples, and hallucination corrections. Not needed for MVP (single-pass, stateless). |
| Storage | None | CV .docx is generated in-memory per request, returned as base64 |
| Testing (unit) | node:test + node:assert/strict | Zero dependency, no config drift. Test-only injection via optional function parameters. Run: `npm test`. |
| Testing (E2E) | @playwright/test | HTTP-level API tests in `tests/e2e/`. Requires a running dev server (`npm run dev`). Run: `npm run test:e2e`. Set `RUN_E2E_LLM_TESTS=true` to include the full LLM call test. |
| Observability | LangFuse + LangSmith | Dual tracing on all LLM calls |
| Deployment | Railway (Hobby) | No function timeout ceiling. Deployed as a standard Node.js app. |
| Package manager | npm | |

> **Data Access Layer tests:** Not applicable in MVP (stateless, no database). DAL test coverage is deferred to the SQLite learning-system phase (post-MVP). See `docs/arch/LEARNING_SYSTEM.md` for the planned data model.

## Architecture

```text
POST /api/tailor-cv
  {
    jobDescription: string
  }

  ↓

tailor-cv/route.ts
  ├── validate(jobDescription)
  ├── rateLimit(sessionId)
  ├── authenticate (Bearer TAILOR_API_KEY)
  ├── requireMasterCv (MASTER_CV_JSON / MASTER_CV_PATH)
  ├── getCuratorPrompt()        → Langfuse Prompt Management ("cv-curator-json", label: production)
  │     └── fallback: hardcoded prompt in curator-prompt.ts (kept in sync with Langfuse)
  ├── applyCurationModePolicy(prompt, curationMode)
  ├── compileCuratorPrompt(prompt, masterCv)
  ├── chat(messages, systemPrompt, { langfusePrompt })  → LLM (via TAILOR_MODEL)
  │     └── generation.linkedPrompt = { name, version, isFallback }
  ├── extractStructuredJson(content)
  ├── validateCvJson(curatedJson)
  ├── buildJsonDocxBase64(curatedJson)
  └── return { cv, curatedJson, builderVersion, ... }
```

See [Pipeline enhancements](./PIPELINE_ENHANCEMENTS.md) for the two-pass pipeline and batch processing designs.

### Key decisions

- **Master CV injection**: The canonical master CV JSON is injected into the curator prompt. No selective retrieval in MVP. Fine-grained RAG and metadata tagging are explicitly rejected in v1 to preserve architectural simplicity.
- **Multi-Tenant Road Map & Isolation (Future)**: When scaling to a multi-user model, user career data will remain strictly isolated at the level of private Markdown files (rather than shared database entries). Onboarding will utilize an automated ingestion pipeline featuring an "Onboarding Iceberg Principle"—extracting unpolished, under-the-radar scale, team size, budget, and impact metrics typically pruned from a single uploaded CV, converting them to high-fidelity Markdown blocks using an agentic conversation flow.
- **Word .docx output**: LLM produces schema-validated curated JSON; server mechanically builds `.docx` via the `docx` npm package. Returns as base64. CCC (separate app) decodes and attaches to Gmail drafts.
- **Provider-specific pricing tiers are per-request configuration.** OpenRouter supports `service_tier: flex` for OpenAI and Google models — discounted, latency-tolerant execution (controlled via the `openRouterFlex` flag on `ChatOptions`, default `true`). Providers that don't support flex silently ignore the option. Anthropic batch processing requires calling the Anthropic API directly (not via OpenRouter), which is why Anthropic models always use the direct provider. The caller chooses the pricing tier per request through the provider and options it selects — there is no global "always flex" or "always instant" setting.
- **Provider/model namespace for all LLM routing**: Every model identifier is `provider/model`. The first `/`-delimited segment names the provider; the remainder is the model ID passed to that provider's API. No bare aliases (e.g. `sonnet`, `gpt-4o`) — the provider must be explicit. Adding a new model or provider is a config change (env var), not a code change (no new `if` branches in routing logic). This contract eliminates the ambiguity of inferring a provider from model name conventions.
- **Separate model**: CV generation uses a different model (`TAILOR_MODEL` env var) than the chat bot. Frontier model expected (Gemini 2.5 Pro, DeepSeek V4 Pro, Sonnet) since reasoning quality matters more than cost here.
- **No reply draft in MVP**: Recruiter reply generation is deferred. Will be added as a second LLM call in the same endpoint invocation later.
- **Langfuse Prompt Management**: The curator system prompt lives in Langfuse (`cv-curator-json`, text type). At runtime, the app fetches the `production`-labeled version with 300s caching. A hardcoded fallback in `curator-prompt.ts` ensures availability if Langfuse is unreachable. Prompt updates are done programmatically via the Langfuse API/SDK — no UI-only workflows. Each LLM generation is linked to its prompt version via the native `prompt` attribute for tracing full version lineage.
- **Bearer auth**: `POST /api/tailor-cv` requires `Authorization: Bearer <TAILOR_API_KEY>`. Single-user shared secret; no sessions or accounts.

### Anti-patterns

- Do NOT fork the CV platform project. This project consumes the knowledge base directly from its own filesystem. Phase 2 will add a CV platform API integration.
- Do NOT add frontend pages or components. This is an API-only project.
- Do NOT add selective context retrieval in MVP. Inject everything.
- Do NOT edit the CV prompt directly in `cv-prompt.ts` and ship it — use the Langfuse UI or API to create a new version, then bump the reference. The hardcoded fallback must be kept in sync manually when the prompt evolves.
- Do NOT rely on Langfuse `latest` label in production — always use `production` label for deterministic prompt versioning.
- Do NOT build batch processing inside the Next.js API layer. The worker is a separate process.
- Do NOT commit to a batch model before running structured evaluation against the 8-part framework.

## File layout

See [File layout reference](./FILE_LAYOUT.md).

## Constraints

- **No Vercel free tier**: Deployed on Railway (Hobby, no timeout ceiling). Vercel Hobby's 10s function timeout is too short for frontier LLM calls generating full CVs.
- **Knowledge base is read-only at runtime**: Files are read from disk, not mutated by the API.
- **Stateless (MVP)**: No database, no sessions beyond in-memory rate limiting. Each request is independent. Learning system (post-MVP) adds SQLite for feedback and few-shot storage — still ephemeral per-deployment, not a persistent multi-tenant database.
- **Environment variables only**: All secrets via env vars. No hardcoded keys. No config files with secrets.
