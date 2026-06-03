# Pipeline Enhancements

Post-MVP improvements to the CV generation pipeline. These address the "reasoning gap" — the core challenge of reading intent from a JD and accurately mapping it to experience without overstating or fabricating.

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

## Batch processing path (future)

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
