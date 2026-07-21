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
│           ├── llm.ts            # Multi-provider LLM client
│           ├── curator-prompt.ts # JSON curator prompt (Langfuse cv-curator-json + fallback)
│           ├── master-cv.ts      # MASTER_CV_JSON / MASTER_CV_PATH loader
│           ├── cv-schema.ts      # Ajv draft-2020-12 validation + size limits
│           ├── json-docx-builder.ts # Mechanical JSON → .docx (BUILDER_VERSION)
│           ├── tailor-auth.ts    # Bearer shared-secret gate
│           ├── smoke-helpers.ts  # Smoke judge gates + artifact redaction
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
│           ├── knowledge-base.ts # Legacy markdown KB helpers (not tailor hot path)
│           ├── markdown-docx.ts  # Legacy markdown → .docx (not tailor hot path)
│           ├── cv-prompt.ts      # Legacy markdown tailor prompt (not hot path)
│           ├── redis.ts          # Shared Upstash Redis client singleton
│           ├── rate-limit.ts     # Dual IP + secret-hash rate limiter
│           ├── tailor-cv-validation.ts  # Request body validation
│           ├── eval-schema.ts     # Judge prompts (incl. JSON smoke), JUDGE_MAP
│           ├── eval-extract.ts    # JD metadata extraction (legacy eval helpers)
│           ├── eval-format.ts     # 8-part format compliance checker
│           ├── eval-judge.ts      # LLM judges (JSON smoke + legacy markdown scorers)
│           └── eval-cv-helpers.ts # parseEvalModels / artifact payload helpers
├── knowledge-base/               # Legacy markdown corpus + test-jds/ for smoke defaults
│   └── test-jds/                 # Raw recruiter JD fixtures (smoke default)
├── references/json-curator/      # Port refs: schema, sample, resume_builder.js, curator prompt
├── lib/
│   ├── env.ts                    # Env var parsing and model getters
│   ├── providers.ts              # Provider type + KNOWN_PROVIDERS leaf registry
│   └── formatDate.ts             # Date formatting utility
├── scripts/
│   ├── create-langfuse-prompts.ts  # Upload prompts to Langfuse
│   ├── e2e-tailor-cv.ts           # npm run smoke — live API + JSON judges
│   ├── regen-docx.ts              # npm run regen-docx — mechanical rebuild
│   ├── seed-eval-results.ts       # Seed historical eval-results artifacts
│   └── verify-rate-limit.ts       # Live Upstash rate-limit check
├── tests/
│   ├── e2e/api.e2e.ts                     # Playwright API checks (Bearer / bypass)
│   ├── curator-prompt.test.ts             # Curator prompt contract
│   ├── json-docx-builder.test.ts          # Builder + regen CLI
│   ├── smoke-helpers.test.ts              # Judge gates + redaction
│   ├── master-cv.test.ts / cv-schema.test.ts
│   ├── tailor-auth.test.ts
│   ├── route.test.ts                      # Tailor route (mocked curator)
│   ├── cv-prompt*.test.ts                 # Legacy markdown prompt tests
│   ├── markdown-docx.test.ts              # Legacy markdown→docx
│   └── …                                  # LLM, rate-limit, env, etc.
├── eval-results/                 # Eval output artifacts per JD×model
├── docs/
│   ├── arch/
│   │   ├── APP_WALKTHROUGH.md            # Start-to-finish flow with file/function refs
│   │   └── …
│   ├── struan-8-part-cv-framework.md     # Reference for CV output structure
│   └── plan/llm-eval-pipeline/           # Active eval pipeline plan
├── instrumentation.ts           # Next.js register → ensureSecureStartup (R5d)
├── next.config.mjs              # Next.js config (OTEL external packages)
├── railway.toml                 # Railway deployment config
├── .coderabbit.yaml             # CodeRabbit review config
├── .env.example                 # Environment variable template
├── package.json                 # Dependencies
└── tsconfig.json                # TypeScript config
```
