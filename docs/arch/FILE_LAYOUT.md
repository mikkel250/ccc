# File Layout

Canonical project tree for the CV Tailoring API. The tree is the source of truth for module locations; if a file is missing, create it at the path shown here.

```text
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
│           ├── chat-prompt.ts    # Chat assistant system prompt (legacy, no route yet)
│           ├── jd-prompt.ts      # Job description analysis prompt (evaluation rubric inside)
│           ├── prompts.ts        # Chat prompt builder (legacy, no route yet)
│           ├── langfuse-prompts.ts  # Prompt management abstraction layer
│           ├── tracers/          # Unified LangSmith + Langfuse tracing adapters
│           │   ├── tracer.ts     # TracePayload + Tracer interface
│           │   ├── langsmith.ts  # LangSmith adapter
│           │   ├── langfuse.ts   # Langfuse adapter (+ initLangFuse export)
│           │   └── index.ts      # recordLangSmithTrace / recordLangfuseTrace
│           ├── langfuse-otel.ts  # OTEL bootstrap (lazy)
│           ├── knowledge-base.ts # Full KB load for tailor-cv (getAllContext)
│           ├── markdown-docx.ts  # Markdown → .docx conversion
│           ├── redis.ts          # Shared Upstash Redis client singleton
│           ├── rate-limit.ts     # IP-based burst rate limiter (Upstash Redis-backed)
│           ├── tailor-cv-validation.ts  # Request body validation
│           ├── eval-schema.ts     # Eval scoring dimensions, judge prompts, JUDGE_MAP
│           ├── eval-extract.ts    # JD metadata extraction for eval stage 1
│           ├── eval-format.ts     # 8-part format compliance checker
│           └── eval-judge.ts      # LLM-as-Judge scorers (extraction, relevance, hallucination)
├── knowledge-base/               # Candidate profile data (Markdown files)
│   ├── career-story.md           # ~~28KB career narrative
│   ├── experience.md             # 25KB work experience
│   ├── skills.md                 # 28KB skills inventory
│   ├── projects.md               # 12KB project details
│   ├── meta-project.md           # 19KB about this project itself
│   └── test-jds/                 # Real JDs for eval (MVP)
├── lib/
│   ├── env.ts                    # Env var parsing and model getters
│   ├── providers.ts              # Provider type + KNOWN_PROVIDERS leaf registry
│   └── formatDate.ts             # Date formatting utility
├── scripts/
│   ├── create-langfuse-prompts.ts  # Upload prompts to Langfuse
│   ├── e2e-tailor-cv.ts           # End-to-end smoke tests for /api/tailor-cv
│   ├── eval-cv.ts                 # LLM-as-Judge evaluation pipeline (MVP)
│   └── seed-eval-results.ts       # Seed eval-results artifacts for local/dev review
├── tests/
│   ├── cv-prompt.test.ts                  # compileCvPrompt() unit tests
│   ├── cv-prompt-struan-fallback.test.ts  # Struan 8-part framework contract tests
│   ├── tailor-cv-validation.test.ts       # Request validation tests
│   ├── llm-chat-dispatch.test.ts          # LLM provider routing tests
│   ├── llm-openrouter.test.ts             # OpenRouter-specific tests
│   ├── llm-provider-detection.test.ts     # detectProvider() tests
│   ├── redis.test.ts                      # Upstash Redis client tests
│   ├── rate-limit.test.ts                 # Rate limiter tests (mock-based)
│   ├── markdown-docx.test.ts              # DOCX conversion tests
│   ├── tracers.test.ts                    # Tracer dispatcher flush-semantics tests
│   ├── eslint-config.test.ts              # ESLint config tests
│   ├── eval-architecture-docs.test.ts     # MODEL_SELECTION.md / .env.example contract tests
│   ├── eval-cv.test.ts                    # eval-cv.ts runner unit tests
│   ├── eval-extract.test.ts               # JD extraction unit tests
│   ├── eval-format.test.ts                # Format compliance checker tests
│   ├── eval-judge.test.ts                 # LLM-as-Judge scorer unit tests (mock LLM)
│   ├── eval-schema.test.ts                # eval-schema types, JUDGE_MAP, prompts
│   ├── eval-tailor-model-default.test.ts  # TAILOR_MODEL default vs eval model set
│   └── test-jds.test.ts                   # knowledge-base/test-jds fixture contract tests
├── eval-results/                 # Eval output artifacts per JD×model
├── docs/
│   ├── arch/
│   │   ├── APP_WALKTHROUGH.md            # Start-to-finish flow with file/function refs
│   │   └── …
│   ├── struan-8-part-cv-framework.md     # Reference for CV output structure
│   └── plan/llm-eval-pipeline/           # Active eval pipeline plan
├── instrumentation.ts           # Next.js instrument hook (no-op)
├── next.config.mjs              # Next.js config (OTEL external packages)
├── railway.toml                 # Railway deployment config
├── .coderabbit.yaml             # CodeRabbit review config
├── .env.example                 # Environment variable template
├── package.json                 # Dependencies
└── tsconfig.json                # TypeScript config
```
