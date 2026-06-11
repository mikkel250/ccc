---
tags: [architecture, cv, prompt-design, hallucination, output-structure]
created: 2026-06-07
source: docs/struan-8-part-cv-framework.md
---

# Sam Struan 8-Part CV Framework

## Problem
LLM-generated CVs hallucinate when the entire document is treated as a rewriting target. Rewriting everything per JD invites inconsistency, fabrication, and attention dilution. Recruiters also lack company context that would make accomplishment bullets credible.

## Solution
Separate the CV into **stable sections** (factual, unchanging) and **one tailoring surface** (Relevant Accomplishments). Eight ordered parts:

1. **Contact Information** — Factual, never invented
2. **Objective Value Statement** — Light tailoring; all facts from KB
3. **Relevant Accomplishments** — The **primary tailoring surface**; 2-3 bullets mirroring JD priorities
4. **Technical Skills** — Keyword-rich ATS list; no generic soft skills
5. **Standard Job Information** — Unambiguous per-role record (company, title, location, dates)
6. **Company Summaries** — 1-2 lines per employer: what they do, size, revenue, where you sat in org
7. **Measurable Accomplishments** — Scope + impact + scale with numbers; reorder for JD relevance, never invent
8. **Education** — Omit entirely if no data in KB (no "N/A")

### Key architectural decisions
- **Stable/factual separation** reduces hallucination surface — only part 3 changes meaningfully per JD
- **Company summaries** (part 6) frame bullets in believable scale — one of the most overlooked résumé sections
- **Grounding rule:** every fact must appear in `knowledge-base/` content; no invented employers, dates, metrics, or tools
- **Strict Markdown output only** — no HTML, tables, JSON, or code fences (docx parser requirement)
- **Sync contract:** production uses Langfuse `cv-tailor-system` (label: `production`); fallback in `cv-prompt.ts` kept aligned manually

## See Also
- [Original source](docs/struan-8-part-cv-framework.md)
- [Unstructured Markdown KB vs Validation Strictness](docs/solutions/unstructured-markdown-kb-vs-validation.md)
- [CV Prompt: Section Ambiguity](docs/solutions/cv-prompt-section-ambiguity.md)
