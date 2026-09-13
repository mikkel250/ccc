# Pipeline Enhancements

Post-MVP improvements to the CV generation pipeline. These address the "reasoning gap" — the core challenge of reading intent from a JD and accurately mapping it to experience without overstating or fabricating.

**Current product (v1):** single-pass JSON curator (`runTailorCore`), operator-reviewed smoke artifacts, no on-path LLM judges. Sections 1–3 below are exploratory designs, not active scope. See [retire LLM judges](../plans/2026-09-03-001-feat-retire-llm-judges-plan.md).

**Runtime (v1):** sync tailor via `POST /api/tailor-cv` and in-process inbox scan (`app/api/lib/inbox-tailor.ts` → `runTailorCore`). See [Inbox scan runtime](#inbox-scan-runtime-current) below — this is **not** the deferred native LLM batch API path.

## 1. Two-Pass Pipeline (Intent Extractor → Synthesizer)

Splits the single-pass LLM call into two focused steps to prevent the model from getting lost in a wall of text:

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

- **Separation of concerns**: Pass 1 handles JD comprehension; Pass 2 handles experience mapping and prose. Four cognitive tasks (parse, search, match, format) split across two calls reduces hallucination from attention dilution.
- **Explicit gap handling**: Without the full knowledge base, Pass 1 may surface intents the candidate can't match. Pass 2's prompt must explicitly instruct "note gaps, don't fabricate" — this makes missing experience visible rather than papered over.
- **Cost**: Two calls instead of one, but each call processes less total context. Net token cost is roughly similar since the knowledge base is only loaded in Pass 2.

## 2. Structured Intermediate Output (JSON mapping)

Before generating markdown prose, the Synthesizer (Pass 2) must first produce a structured mapping matrix:

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

This forces the model's attention to align data before writing prose. It's a well-known prompt engineering technique — the act of filling in a structured schema reduces extrapolation errors. Chained within a single Pass 2 call: output JSON mapping → output markdown CV.

## 3. Critic Node (LLM-as-a-Judge)

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

- **Test-phase only initially**: Critical to measure hallucination rate of the two-pass pipeline before adding this loop. Don't optimize a problem that hasn't been measured.
- **Future interactive use**: Beyond batch processing, the critic node can power a user-facing "edit with AI" flow — users request changes to specific sections and the LLM refines the CV within guardrails. The goal is that this becomes rarely needed as pipeline quality improves.
- **Different model**: Using a different provider/model for the critic avoids self-confirmation bias. E.g., Claude Haiku as critic for DeepSeek-generated CVs, or vice versa.
- **Cost**: Doubles LLM calls (generation + critic). Only worth it if hallucination rate in the two-pass pipeline remains above acceptable threshold after eval.

## Inbox scan runtime (current)

The Gmail inbox worker ships as **library code in this Next.js repo**, not a second deployed service.

```text
Trigger: npm run inbox:scan (local tsx CLI)  OR  Railway cron (M8.6, same entrypoint)
  ↓
List labeled Gmail messages; claim unprocessed ids (Upstash Redis)
  ↓
Extract JD from message body
  ↓
runTailorCore (strict, in-process — same curator + mechanical .docx as HTTP tailor)
  ↓
Create Gmail thread draft with replyText + CV .docx attach (M8.5)
  ↓
Mark message processed in Redis
```

Key decisions:

- **Same repo, same engine**: Only the entrypoint differs — HTTP adapter (`buildTailorResponse`) vs inbox adapter (`tailorLabeledMessage`). Prompts, schema validation, and `.docx` build are shared.
- **Not HTTP-presented**: Inbox must not call `POST /api/tailor-cv` or consume public rate-limit buckets (product contract R8).
- **Local first**: Prove the loop with `npm run inbox:scan`; Railway cron (M8.6) is the unattended schedule when the laptop is closed — not a different worker architecture. Until M8.6, hosting can stay local-only ($0).
- **Railway hosts sync v1**: Chosen for live `chat()` tailor and serial inbox scans, not because batch polling requires a long-lived blocker. See [Deployment hosting](./README.md#deployment-hosting-railway-vs-vercel).

Product contract: [inbox worker plan](../plans/2026-09-05-002-feat-inbox-worker-plan.md).

## Native LLM batch APIs (deferred)

Sync tailor and inbox scan use **live** `chat()` calls today. A separate **cost optimization** path — provider native batch APIs — is designed but not built.

**How batch APIs actually work:** submit message requests and receive a `batch_id` (seconds) → **poll** batch status on a schedule (each GET is short; completion may take minutes to hours) → **retrieve** results when status is `ended`. You do **not** hold one HTTP connection or worker process open waiting for the model. The infra gap is **durable state between poll ticks** (store `batch_id`, pending JD, retrieval cursor) — e.g. Upstash — not a blocking daemon.

```text
Cron or CLI tick (short invocation — Vercel cron or Railway cron both viable for this lane alone)
  ↓
Pending work queue (Redis / DB — batch ids survive between ticks)
  ↓
Submit new batches / poll in-flight / retrieve completed
  ↓
Shared curator engine (same prompts + master CV + schema path as sync)
  ↓
Write artifacts / notify operator (no v1 product UI)
```

Key decisions:

- **Not the inbox scan job**: Gmail scan + in-process tailor is current M8 work and uses **sync** `runTailorCore`, not Message Batches. Native LLM batch APIs are deferred until single-pass quality is settled and poll/state infra exists.
- **Do not block user-facing routes**: Submit/poll/retrieve must not run inside a single `POST /api/tailor-cv` request. A future cron-triggered poller (could be a route **only** invoked by cron) is fine; see [MODEL_SELECTION](./MODEL_SELECTION.md).
- **Vercel is not ruled out for batch-only polling** — earlier “serverless timeout” wording targeted **sync** tailor, not periodic poll. v1 still defaults to Railway because sync API + inbox scan are the active workloads.
- **Depends on judge-free sync path**: One curator call per JD (see [retire LLM judges](../plans/2026-09-03-001-feat-retire-llm-judges-plan.md)).
- **Tiered delivery (future)**: Sync path = interactive; batch path = economy tier (async, cost-optimized). BYOK is out of product scope (`STRATEGY.md`).

Historical note: an earlier sketch tied batch to a multi-source JD queue and frontend notification. v1 uses Gmail as the review surface and inbox scan as the inbound path instead.
