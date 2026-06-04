# Architecture

Architecture decisions, code conventions, module boundaries, and infrastructure choices for the CV Tailoring API.

See also: [Architecture index](./README.md), [Model selection](./MODEL_SELECTION.md), [File layout](./FILE_LAYOUT.md).

## Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Language | TypeScript 5 | Strict mode |
| Framework | Next.js 15 App Router | API routes only (`app/api/`) |
| Runtime | Node.js 22 LTS | Railway deployment |
| LLM | Multi-provider dispatch | Model strings use `provider/model` namespace. LLM-as-Judge eval pipeline — complete (MVP). |
| Testing | node:test + node:assert/strict | Zero dependency test runner |
| Observability | LangFuse + LangSmith | Dual tracing on all LLM calls |

## Request flow

```
POST /api/tailor-cv
  → validate → rateLimit → getCvPrompt → compileCvPrompt → getAllContext
  → chat(TAILOR_MODEL) → generateDocx → return base64 .docx
```

### Evaluation pipeline

The eval runner (`scripts/eval-cv.ts`) benchmarks CV generation across candidate models and real test JDs (`knowledge-base/test-jds/`). Test JDs are raw, unstructured recruiter text (no YAML frontmatter).

**Two-stage flow:**

**Stage 1 — JD extraction gate (per JD, cached):**

1. **JD extraction** — `extractJdMetadata()` in `eval-extract.ts` calls an LLM to produce structured `JdExtraction` (requirements, keyword bank, hiring context, role type, implicit success signals).
2. **Extraction judge** — `scoreExtraction()` in `eval-judge.ts` scores completeness/accuracy against raw JD (0.0–1.0). Extraction is cached per JD slug for the run duration (in-memory `Map`). If score < `EVAL_EXTRACTION_MIN_SCORE` (default 0.7), all model evaluations for that JD are skipped with a warning.

**Stage 2 — CV generation and scoring (per JD×model pair):**

1. **Format compliance** (automated) — `scoreFormatCompliance()` in `eval-format.ts` checks the 8-part Struan structure (0.0–1.0).
2. **Accomplishment relevance** (LLM-as-Judge) — cross-provider judge scores alignment of Relevant Accomplishments against verified structured extraction (1–5).
3. **Hallucination rate** (LLM-as-Judge) — cross-provider judge cross-references claims against knowledge base ground truth; extraction provides JD context (0.0–1.0).

Scores are pushed to Langfuse via `@langfuse/client` (`langfuse.score.create()`) on all four dimensions. Artifacts:

- `eval-results/<jd-slug>/extraction.json` — JD-level structured extraction + extraction score
- `eval-results/<jd-slug>/<model>/raw-cv.md` — generated CV markdown
- `eval-results/<jd-slug>/<model>/scores.json` — all four dimension scores + metadata
- `eval-results/<jd-slug>/<model>/usage.json` — token counts, latency, cost estimate

Schema and judge prompts live in `app/api/lib/eval-schema.ts`. Extraction in `eval-extract.ts`. Judge scorers in `eval-judge.ts`. Traces are flushed before script exit.

**Future gating (deferred):** When stage 1 extraction is consistently high-confidence, the extraction judge can be skipped or sampled.

### Key decisions

- **Full context injection**: All knowledge base files loaded into every LLM call (MVP).
- **Provider/model namespace**: Every model identifier is `provider/model`. Adding providers is config, not routing code changes.
- **Separate TAILOR_MODEL**: CV generation uses an independent model from chat defaults.
- **Langfuse Prompt Management**: CV system prompt fetched from Langfuse with hardcoded fallback.

## Constraints

- Knowledge base is read-only at runtime.
- Stateless MVP — no database.
- Environment variables only for secrets and tunables.
