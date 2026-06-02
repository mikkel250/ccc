## Stack context (for agents)

This project is the **CV Tailoring API** — a lightweight Next.js 15 backend that will be deployed on Railway. It exposes a single endpoint (`POST /api/tailor-cv`) that accepts a job description and returns a tailored CV as a base64-encoded `.docx` file, generated via LLM against a canonical career knowledge base. There is no frontend and no auth — the knowledge base lives as markdown files on disk. A learning system with local SQLite storage is planned post-MVP.

The project was cloned from `portfolio-react-ts` and stripped of all portfolio pages, components, and styles. Only the API layer and knowledge base were retained.

## Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Language | TypeScript 5 | Strict mode |
| Framework | Next.js 15 App Router | API routes only (`app/api/`). No pages, no components, no layout beyond API root. |
| Runtime | Node.js 22 LTS (≥22.0.0) | Railway (Nixpacks reads `.nvmrc`); no Edge Functions |
| LLM | OpenAI, Anthropic, Google Gemini, DeepSeek via OpenRouter + native batch APIs | Multi-provider sync + async batch. Separate worker for cost-optimized batch processing. Separate `TAILOR_MODEL` env var for CV generation (frontier model). |
| Auth | None | MVP is single-user, no auth layer |
| Database | SQLite (MVP), PostgreSQL + pgvector (future) | Learning system stores feedback, few-shot examples, and hallucination corrections. Not needed for MVP (single-pass, stateless). |
| Storage | None | CV .docx is generated in-memory per request, returned as base64 |
| Testing | Jest | Existing test infrastructure from portfolio project |
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

### Batch processing path (future)

The instant API path is the MVP. The following batch architecture is designed but not yet built:

```
Scheduled Worker (cron, 3x/day)
  ↓
Queue (pending JDs from any source: email, paste, link, job board)
  ↓
Shared CV Engine (same as instant path: cv-prompt.ts + knowledge-base + framework)
  ↓
Batch LLM dispatch (OpenRouter flex / Anthropic native batch / DeepSeek native batch)
  ├── submit job
  ├── poll status
  └── retrieve results
  ↓
Generated CVs → store → notify frontend
```

Key decisions:

- **Separate worker process**: Decoupled from the Next.js API server. Runs on Railway via cron or a standalone script. Avoids serverless timeout issues with long-running batch submission/polling.
- **Queue-backed inputs**: JDs from any source (email, paste, link, job boards) land in the same queue. The worker does not care about input origin.
- **Shared CV engine**: The same prompt assembly, knowledge base injection, and 8-part framework logic serves both sync (instant) and async (batch) paths. Only the LLM dispatch mechanism differs.
- **Tiered delivery**: Instant path = premium tier (sync, frontier model). Batch path = economy tier (async, cost-optimized, up to 24h turnaround). BYOK option lets users bring their own API keys for direct provider pricing.
- **Provider strategy**: OpenRouter flex for OpenAI/Google models during MVP. Native batch APIs for Anthropic. DeepSeek initially via OpenRouter (passes through 75%-discounted base at $0.435/$0.87/M), with a planned migration to direct DeepSeek API for batch processing — direct off-peak (9:30 AM–5:30 PM PDT) cuts rates another 50% to $0.22/$0.44/M. Three distinct batch protocols (submit → poll → retrieve) to maintain.

### Model selection

Model for CV generation is not yet finalized. Candidates:

| Model | Provider | Estimated cost/M tokens | Rationale |
|-------|----------|------------------------|-----------|
| DeepSeek V4 Pro | DeepSeek native batch (direct) | $0.22 in / $0.44 out (off-peak direct) | Near-frontier quality at fraction of cost; primary candidate. OpenRouter passes through the 75%-discounted base rate ($0.435/$0.87) but does NOT apply the extra 50% off-peak discount that direct DeepSeek API offers during 9:30 AM–5:30 PM PDT. Plan to transition from OpenRouter → direct DeepSeek API before batch launch. |
| Claude Haiku 4.5 | Anthropic native batch | ~$0.25–0.50 | Best human-like text generation |
| Gemini 2.5 Flash | Google via OpenRouter flex | ~$0 free tier or low cost | Fast, free tier available |
| GPT-4o-mini | OpenAI via OpenRouter flex | ~$0.15 | Reliable, widely used |
| Kimi K2.5 | Moonshot native batch | $1.80/M output (batch) | Leads IFEval at 94.0 (instruction following); open-weight. Deprioritized: 4x DeepSeek's cost without proportionate quality gain for this task, which requires JD intent reasoning, not just format compliance. |
| Qwen3.5-35B | Alibaba Cloud | ~$0.50–1.00 | Best structured extraction accuracy on SOB benchmark (80.1% leaf-value). Deprioritized: coding benchmarks (proxy for reasoning) don't beat DeepSeek; format compliance alone is not the differentiator. |

Evaluation planned (post-MVP): Run 3+ models against 2–3 real JDs, score on hallucination rate, 8-part format compliance, and accomplishment relevance. Langfuse prompt management and evaluation framework will be used. No model choice is committed until eval results are in.

### CV generation pipeline enhancements (post-MVP)

These pipeline improvements address the "reasoning gap" — the core challenge of reading
intent from a JD and accurately mapping it to experience without overstating or fabricating.
All three are designed for the non-batched (instant) path but the two-pass pipeline and
structured output will also apply to batch processing.

#### 1. Two-Pass Pipeline (Intent Extractor → Synthesizer)

Splits the single-pass LLM call into two focused steps to prevent the model from getting
lost in a wall of text:

```
Pass 1 — Intent Extractor
  Input: JD only (no knowledge base)
  Prompt: "Identify the top 5 core intents of this role. Look past keywords — what is
          the underlying pain point this manager is trying to solve?"
  Output: Clean JSON list of intents

Pass 2 — Synthesizer
  Input: Knowledge base + Pass 1 JSON output
  Prompt: "Map my experience directly to these 5 strategic pain points. If no experience
          matches an intent, note the gap rather than fabricating."
  Output: Full 8-part markdown CV
```

Key decisions:
- **Separation of concerns**: Pass 1 handles JD comprehension; Pass 2 handles experience
  mapping and prose. Four cognitive tasks (parse, search, match, format) split across
  two calls reduces hallucination from attention dilution.
- **Explicit gap handling**: Without the full knowledge base, Pass 1 may surface intents
  the candidate can't match. Pass 2's prompt must explicitly instruct "note gaps, don't
  fabricate" — this makes missing experience visible rather than papered over.
- **Cost**: Two calls instead of one, but each call processes less total context. Net
  token cost is roughly similar since the knowledge base is only loaded in Pass 2.

#### 2. Structured Intermediate Output (JSON mapping)

Before generating markdown prose, the Synthesizer (Pass 2) must first produce a
structured mapping matrix:

```json
{
  "mappings": [
    {
      "jd_requirement": "extracted from Pass 1",
      "matching_skill": "from knowledge base",
      "justification_of_intent_fit": "why this matches the underlying pain point"
    }
  ]
}
```

This forces the model's attention to align data before writing prose. It's a well-known
prompt engineering technique — the act of filling in a structured schema reduces
extrapolation errors. Chained within a single Pass 2 call: output JSON mapping → output
markdown CV.

#### 3. Critic Node (LLM-as-a-Judge)

After generating the tailored CV, a different model reviews the output for quality:

```
Pass 3 — Critic
  Input: Generated CV + original JD
  Prompt: "Act as a cynical hiring manager. Review this CV against the JD. Identify
          3 places where the model hallucinated, weak-mapped intent, or overstated
          experience."
  Output: List of corrections

Pass 4 — Refinement (optional)
  Input: CV + critic feedback
  Action: Feed corrections back to primary model for final polish
```

Key decisions:
- **Test-phase only initially**: Critical to measure hallucination rate of the two-pass
  pipeline before adding this loop. Don't optimize a problem that hasn't been measured.
- **Future interactive use**: Beyond batch processing, the critic node can power a
  user-facing "edit with AI" flow — users request changes to specific sections and the
  LLM refines the CV within guardrails. The goal is that this becomes rarely needed as
  pipeline quality improves.
- **Different model**: Using a different provider/model for the critic avoids
  self-confirmation bias. E.g., Claude Haiku as critic for DeepSeek-generated CVs, or
  vice versa.
- **Cost**: Doubles LLM calls (generation + critic). Only worth it if hallucination rate
  in the two-pass pipeline remains above acceptable threshold after eval.

### Learning system (post-MVP)

The pipeline should improve over time as it accumulates user feedback and outcome data.
The primary learning target is **hallucination reduction** — style improvements are secondary.

Recommended implementation sequence: feedback capture → hallucination contrastive memory
+ dynamic few-shot → persona evolution. Feedback capture is a prerequisite for everything
below.

#### 1. Feedback Capture (prerequisite)

Every CV generation must have a feedback collection point:

- **Inline editing**: Direct text modifications to generated bullet points
- **Binary/scale ratings**: "Did the model correctly match this accomplishment to the JD
  intent?" (Yes/No/Partial)
- **Categorized critiques**: Tags like "overstated," "wrong metric," "missed intent,"
  "wrong tone"

This data drives both short-term learning (few-shot examples) and long-term analysis
(style rules, hallucination patterns).

#### 2. Hallucination Contrastive Memory

The highest-leverage learning target. Every time the critic or manual review flags a
fabrication, store it as a contrastive pair:

```
(hallucinated_claim, correct_fact_from_knowledge_base)
```

When future JDs touch the same experience area, inject into the prompt:
*"Avoid: X. Use instead: Y."* This directly attacks the core quality problem and gets
stronger with use. Low complexity, high leverage.

#### 3. Dynamic Few-Shot Routing (short-term memory)

The easiest form of "learning" without retraining:

1. Store every approved CV bullet alongside its triggering JD requirement
2. On new JD: embed the JD intent, search the vector DB for top-3 semantically closest
   past JD requirements
3. Inject those approved examples into the prompt as in-context demonstrations

The model instantly mimics tone, depth, and structural mapping that was previously
approved. Works well for teaching concept-specific mappings (e.g., "how to frame
Kubernetes scaling experience for cloud infrastructure roles vs. platform engineering
roles").

Requires: SQLite/PostgreSQL with vector extension (pgvector), or a dedicated vector store.

#### 4. Persona Evolution (long-term memory)

Automated style and strategy profile that grows over time:

1. **Critique worker**: When a CV is edited or critiqued, a fast reasoning model analyzes
   the original vs. the edit and extracts the underlying rule
2. **Rule extraction**: e.g., "Rule 14: Never use 'spearheaded.' Rule 15: Always quantify
   Kubernetes scaling in pod count, not just 'high traffic.'"
3. **Profile update**: Rules appended to a permanent style profile file, injected into
   every system prompt

Lower priority than contrastive memory and few-shot — style fixes are polish, not
correctness. Depends on having enough feedback data (weeks of use).

#### 5. Callback-Based Achievement Reinforcement (phase 2+)

If the system eventually tracks which CVs lead to interview callbacks, that's the
strongest possible learning signal:

- An accomplishment framed as "Led migration to microservices" might win at startups
- The same accomplishment framed as "Reduced infrastructure spend 60% by deprecating
  legacy monolith" might win at enterprise

Store `(JD_fingerprint, framing, outcome)` and weight similar framings higher for
similar JDs. Plan the data model early — the signal accumulates over months.

#### 6. Prompt Drift Detection (safety net)

Run the same canonical test JD through the pipeline on a schedule. Compare output against
a golden baseline. If quality drops, something degraded — model version change, prompt
drift, or knowledge base inconsistency. Essential for an unattended batch system.

#### 7. Template-Based Generation (CV Cache + Diff)

Because the 8-part framework is mostly stable — only "Relevant Accomplishments" changes
heavily per JD — a past approved CV can serve as a starting template:

```
1. Search vector DB for the most semantically similar past JD to the new JD
2. Retrieve the approved CV generated for that past JD
3. Feed the template CV + new JD intents → LLM diffs only the variable sections
   (Relevant Accomplishments, Objective adjustments, bullet reordering)
4. Preserve stable sections untouched (Contact Info, Standard Job Info, Education, etc.)
```

Key decisions:
- **Saves tokens**: Less input context (no full knowledge base per call if template
  is trusted) and less output (only diff sections, not full CV markdown)
- **Reduces hallucination surface**: Only generating the volatile sections; stable
  sections are guaranteed consistent
- **Template quality matters**: A mismatched template creates risk that the model
  stretches experience to fit rather than admitting a wrong base — the gap-noting
  rule from the two-pass pipeline applies here too
- **Naturally becomes a curation system**: Over time, the collection of approved CVs
  becomes a "greatest hits" library. The best CVs per role category (eng manager,
  staff IC, startup, enterprise) can be manually tagged and preferred in search

This could eventually evolve into a personal CV portfolio — a searchable library of
past applications with metadata (JD type, callback outcome, framing style) rather
than treating each generation as disposable.

### Key decisions

- **Full context injection**: All knowledge base files are loaded into every LLM call. No selective retrieval in MVP. This is ~50-60k tokens, well within frontier model context windows. Fine-grained RAG and metadata tagging are explicitly rejected in v1 to preserve architectural simplicity.
- **Multi-Tenant Road Map & Isolation (Future)**: When scaling to a multi-user model, user career data will remain strictly isolated at the level of private Markdown files (rather than shared database entries). Onboarding will utilize an automated ingestion pipeline featuring an "Onboarding Iceberg Principle"—extracting unpolished, under-the-radar scale, team size, budget, and impact metrics typically pruned from a single uploaded CV, converting them to high-fidelity Markdown blocks using an agentic conversation flow.
- **Word .docx output**: LLM produces markdown-formatted CV; server converts to `.docx` via the `docx` npm package. Returns as base64. CCC (separate app) decodes and attaches to Gmail drafts.
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
