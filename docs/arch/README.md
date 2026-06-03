# Architecture

Architecture decisions, code conventions, module boundaries, and infrastructure choices for the CV Tailoring API.

- [Model selection](./MODEL_SELECTION.md) — provider routing, model defaults, evaluation strategy
- [Pipeline enhancements](./PIPELINE_ENHANCEMENTS.md) — two-pass pipeline, structured output, critic node, batch processing
- [Learning system](./LEARNING_SYSTEM.md) — feedback capture, hallucination memory, few-shot routing, persona evolution, drift detection

---

## Stack context (for agents)

This project is the **CV Tailoring API** — a lightweight Next.js 15 backend that will be deployed on Railway. It exposes a single endpoint (`POST /api/tailor-cv`) that accepts a job description and returns a tailored CV as a base64-encoded `.docx` file, generated via LLM against a canonical career knowledge base. There is no frontend and no auth — the knowledge base lives as markdown files on disk. A learning system with local SQLite storage is planned post-MVP.

The project was cloned from `portfolio-react-ts` and stripped of all portfolio pages, components, and styles. Only the API layer and knowledge base were retained.

## Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Language | TypeScript 5 | Strict mode |
| Framework | Next.js 15 App Router | API routes only (`app/api/`). No pages, no components, no layout beyond API root. |
| Runtime | Node.js 22 LTS (≥22.0.0) | Railway (Nixpacks reads `.nvmrc`); no Edge Functions |
| LLM | OpenAI, Anthropic, Google, DeepSeek, OpenRouter (multi-provider dispatch) | Model strings use `provider/model` namespace. No bare aliases. Provider detection is a config lookup, not an `if` chain. OpenRouter supports `service_tier: flex` (discounted, latency-tolerant) for OpenAI/Google models; Anthropic batch processing requires direct API. Separate `TAILOR_MODEL` for CV generation. Native batch APIs deferred. |
| Auth | None | MVP is single-user, no auth layer |
| Database | SQLite (MVP), PostgreSQL + pgvector (future) | Learning system stores feedback, few-shot examples, and hallucination corrections. Not needed for MVP (single-pass, stateless). |
| Storage | None | CV .docx is generated in-memory per request, returned as base64 |
| Testing | node:test + node:assert/strict | Zero dependency, no config drift. Test-only injection via optional function parameters. |
| Observability | LangFuse + LangSmith | Dual tracing on all LLM calls |
| Deployment | Railway (Hobby) | No function timeout ceiling. Deployed as a standard Node.js app. |
| Package manager | npm | |

## Architecture

```
POST /api/tailor-cv
  {
    jobDescription: string
  }

  ↓

tailor-cv/route.ts
  ├── validate(jobDescription)
  ├── rateLimit(sessionId)
  ├── getCvPrompt()             → Langfuse Prompt Management ("cv-tailor-system", label: production)
  │     └── fallback: hardcoded prompt in cv-prompt.ts (kept in sync with Langfuse)
  ├── compileCvPrompt(prompt, context)  → substitute {{CONTEXT}}
  ├── getAllContext()           → knowledge-base/*.md
  ├── chat(messages, systemPrompt, { langfusePrompt })  → LLM (via TAILOR_MODEL)
  │     └── generation.linkedPrompt = { name, version, isFallback }
  ├── generateDocx(cvMarkdown)  → docx npm package
  └── return { cv: base64docx }
```

See [Pipeline enhancements](./PIPELINE_ENHANCEMENTS.md) for the two-pass pipeline and batch processing designs.

### Key decisions

- **Full context injection**: All knowledge base files are loaded into every LLM call. No selective retrieval in MVP. This is ~50-60k tokens, well within frontier model context windows. Fine-grained RAG and metadata tagging are explicitly rejected in v1 to preserve architectural simplicity.
- **Multi-Tenant Road Map & Isolation (Future)**: When scaling to a multi-user model, user career data will remain strictly isolated at the level of private Markdown files (rather than shared database entries). Onboarding will utilize an automated ingestion pipeline featuring an "Onboarding Iceberg Principle"—extracting unpolished, under-the-radar scale, team size, budget, and impact metrics typically pruned from a single uploaded CV, converting them to high-fidelity Markdown blocks using an agentic conversation flow.
- **Word .docx output**: LLM produces markdown-formatted CV; server converts to `.docx` via the `docx` npm package. Returns as base64. CCC (separate app) decodes and attaches to Gmail drafts.
- **Provider-specific pricing tiers are per-request configuration.** OpenRouter supports `service_tier: flex` for OpenAI and Google models — discounted, latency-tolerant execution (controlled via the `openRouterFlex` flag on `ChatOptions`, default `true`). Providers that don't support flex silently ignore the option. Anthropic batch processing requires calling the Anthropic API directly (not via OpenRouter), which is why Anthropic models always use the direct provider. The caller chooses the pricing tier per request through the provider and options it selects — there is no global "always flex" or "always instant" setting.
- **Provider/model namespace for all LLM routing**: Every model identifier is `provider/model`. The first `/`-delimited segment names the provider; the remainder is the model ID passed to that provider's API. No bare aliases (e.g. `sonnet`, `gpt-4o`) — the provider must be explicit. Adding a new model or provider is a config change (env var), not a code change (no new `if` branches in routing logic). This contract eliminates the ambiguity of inferring a provider from model name conventions.
- **Separate model**: CV generation uses a different model (`TAILOR_MODEL` env var) than the chat bot. Frontier model expected (Gemini 2.5 Pro, DeepSeek V4 Pro, Sonnet) since reasoning quality matters more than cost here.
- **No reply draft in MVP**: Recruiter reply generation is deferred. Will be added as a second LLM call in the same endpoint invocation later.
- **Langfuse Prompt Management**: The CV tailoring system prompt lives in Langfuse (`cv-tailor-system`, text type, `{{CONTEXT}}` variable). At runtime, the app fetches the `production`-labeled version with 300s caching. A hardcoded fallback in `cv-prompt.ts` ensures availability if Langfuse is unreachable. Prompt updates are done programmatically via the Langfuse API/SDK — no UI-only workflows. Each LLM generation is linked to its prompt version via the native `prompt` attribute for tracing full version lineage.
- **No auth**: Single-user. No sessions, no accounts. A simple shared secret or API key may be added later.

### Anti-patterns

- Do NOT fork the CV platform project. This project consumes the knowledge base directly from its own filesystem. Phase 2 will add a CV platform API integration.
- Do NOT add frontend pages or components. This is an API-only project.
- Do NOT add selective context retrieval in MVP. Inject everything.
- Do NOT edit the CV prompt directly in `cv-prompt.ts` and ship it — use the Langfuse UI or API to create a new version, then bump the reference. The hardcoded fallback must be kept in sync manually when the prompt evolves.
- Do NOT rely on Langfuse `latest` label in production — always use `production` label for deterministic prompt versioning.
- Do NOT build batch processing inside the Next.js API layer. The worker is a separate process.
- Do NOT commit to a batch model before running structured evaluation against the 8-part framework.

## File layout

```
/root/
├── app/                          # Next.js App Router
│   ├── layout.tsx                # Root layout (metadata only, no UI)
│   ├── page.tsx                  # Returns notFound() — API-only, no frontend
│   ├── not-found.tsx             # 404 page
│   └── api/
│       ├── hello/route.ts        # Health check GET /api/hello
│       ├── tailor-cv/route.ts    # POST /api/tailor-cv — main CV generation endpoint
│       └── lib/                  # All business logic lives here
│           ├── llm.ts            # Multi-provider LLM client (531 lines)
│           ├── cv-prompt.ts      # CV tailoring prompt (Langfuse + hardcoded fallback)
│           ├── chat-prompt.ts    # Chat assistant system prompt (massive, ~320 lines)
│           ├── chat-prompt.4o-mini.ts        # Model-specific variant
│           ├── chat-prompt.gemini-flash-v0.ts
│           ├── chat-prompt.gemini-flash-v1.ts
│           ├── jd-prompt.ts      # Job description analysis prompt (evaluation rubric inside)
│           ├── prompts.ts        # Chat prompt builder with query classification
│           ├── langfuse-prompts.ts  # Prompt management abstraction layer
│           ├── langfuse.ts       # Langfuse tracing client
│           ├── langfuse-otel.ts  # OTEL bootstrap (lazy)
│           ├── langsmith.ts      # LangSmith tracing (optional)
│           ├── knowledge-base.ts # Context retrieval (RAG, file-based)
│           ├── markdown-docx.ts  # Markdown → .docx conversion
│           ├── rate-limit.ts     # IP-based burst rate limiter
│           └── tailor-cv-validation.ts  # Request body validation
├── knowledge-base/               # Candidate profile data (Markdown files)
│   ├── career-story.md           # ~~28KB career narrative
│   ├── experience.md             # 25KB work experience
│   ├── skills.md                 # 28KB skills inventory
│   ├── projects.md               # 12KB project details
│   └── meta-project.md           # 19KB about this project itself
├── lib/
│   ├── input-filter.ts           # Client-side input filtering (location, salary, JD detection)
│   └── formatDate.ts             # Date formatting utility
├── scripts/
│   ├── create-langfuse-prompts.ts  # Upload prompts to Langfuse
│   └── e2e-tailor-cv.ts           # End-to-end smoke tests for /api/tailor-cv
├── tests/
│   ├── cv-prompt.test.ts                  # compileCvPrompt() unit tests
│   ├── cv-prompt-struan-fallback.test.ts  # Struan 8-part framework contract tests
│   ├── tailor-cv-validation.test.ts       # Request validation tests
│   ├── llm-chat-dispatch.test.ts          # LLM provider routing tests
│   ├── llm-openrouter.test.ts             # OpenRouter-specific tests
│   ├── llm-provider-detection.test.ts     # detectProvider() tests
│   ├── rate-limit.test.ts                 # Rate limiter tests
│   ├── markdown-docx.test.ts              # DOCX conversion tests
│   └── eslint-config.test.ts              # ESLint config tests
├── docs/
│   └── struan-8-part-cv-framework.md     # Reference for CV output structure
├── instrumentation.ts           # Next.js instrument hook (no-op)
├── next.config.mjs              # Next.js config (OTEL external packages)
├── railway.toml                 # Railway deployment config
├── .coderabbit.yaml             # CodeRabbit review config
├── .env.example                 # Environment variable template
├── package.json                 # Dependencies
└── tsconfig.json                # TypeScript config
```

## Constraints

- **No Vercel free tier**: Deployed on Railway (Hobby, no timeout ceiling). Vercel Hobby's 10s function timeout is too short for frontier LLM calls generating full CVs.
- **Knowledge base is read-only at runtime**: Files are read from disk, not mutated by the API.
- **Stateless (MVP)**: No database, no sessions beyond in-memory rate limiting. Each request is independent. Learning system (post-MVP) adds SQLite for feedback and few-shot storage — still ephemeral per-deployment, not a persistent multi-tenant database.
- **Environment variables only**: All secrets via env vars. No hardcoded keys. No config files with secrets.
