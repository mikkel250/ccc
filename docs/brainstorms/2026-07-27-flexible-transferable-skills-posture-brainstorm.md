---
date: 2026-07-27
topic: flexible-transferable-skills-posture
source: STRATEGY.md — Pivot curation posture track
---

# Flexible Transferable-Skills Posture

## What We're Building

A new `flexible` curation posture that reorganizes the entire CV around a **JD-backwards competency mapping** — not just a thesis paragraph. The curator:

1. Extracts underlying competencies from the JD (beneath domain jargon)
2. Maps those competencies to master CV evidence
3. Rewrites the skills section entirely around JD needs
4. Reorganizes experience into JD-derived categories (e.g. "Relevant Experience" / "Other Experience", or domain areas like "Operations & Management", "Hospitality")
5. Consolidates or cuts weak-fit roles, keeping the strongest competency matches at the top
6. Opens with a JD-aware transferable-skills thesis as the OVS

All content stays grounded — no invented facts, titles, or metrics. Existing `flexible` mechanics (title tailoring, role merging, grounded compression) are retained as tools within this structure.

`strict` mode is unchanged — OVS stays evergreen, no thesis synthesis.

**Concrete example of the shift:**

- Today's `flexible` with a JD for a restaurant GM and a tech-manager candidate: tries to stretch tech achievements into restaurant relevance, or correctly scores itself as a weak fit without surfacing the management value.
- New `flexible`: The curator extracts JD competencies — team leadership, P&L ownership, vendor management, operational scaling. Maps to master CV: "led 5-person engineering team" → team leadership, "managed $2M cloud budget" → P&L ownership. OVS thesis: "10-year track record of building and leading cross-functional teams through rapid growth, with demonstrated strength in operational scaling, budget ownership, and stakeholder alignment." Experience section: tech roles reorganized under "Operations & Management" and "Technical Leadership" headings — not "Software Engineering." Skills section: "Team Building," "Budget Management," "Vendor Relations" lead; technical stack consolidated at bottom. Role with no competency match consolidated to a single line under "Other Experience."

## Prior Art

A Claude Project prompt (full CV rewrite + cover letter, JD-backwards competency mapping) has been tested interactively and produces strong pivot-candidate outputs. Key methodology to adapt:

- **JD deconstruction:** extract title, seniority, must-haves, nice-to-haves, core responsibilities, tools/tech, domain knowledge, key verbs, implicit success signals
- **Alignment Snapshot:** top 10 keywords/competencies, gaps, transferable strengths, risks
- **Keyword Bank → CV evidence mapping:** introduce missing-but-true keywords naturally
- **Category-based experience reorganization:** "Relevant Experience" / "Other Experience" headings with strongest matches first
- **Skills section rewritten** as an ATS keyword cluster around JD needs
- **Cover letter generated alongside CV** — pivot roles typically require one to bridge the domain gap

The adaptation for CCC: strip the interactive chat flow, keep the JD deconstruction + CV mapping methodology, add grounding verification, maintain cross-model parity. The cover letter becomes a second artifact in the `flexible` response (markdown, alongside the curated JSON + docx).

## Why This Approach

- **Category-based reorganization is the core mechanism.** Grouping experience into JD-derived categories ("Relevant Experience" / "Other Experience") gives the hiring manager a clear signal about what maps to the role, without the CV needing to pretend the candidate was in the same industry. This is more honest than cross-section culling — weak-fit content isn't deleted, it's consolidated and labeled honestly.
- **JD-backwards mapping avoids a fixed taxonomy.** Transferable dimensions depend on the candidate's background and the JD. A predefined list ("always foreground leadership, communication, ...") would miss JD-specific needs and force irrelevant dimensions. Working backwards from the JD ensures the mapping is JD-relevant and candidate-honest.
- **Existing flexible behaviors are tools, not the posture.** Title tailoring, role merging, and compression are useful mechanics retained within the new structure. They serve the competency mapping — not domain matching.
- **Cover letter for pivot bridging.** Pivot roles typically require a cover letter to explain the domain switch — the CV alone can't do that work. `flexible` mode adds a cover letter artifact (markdown) alongside the curated JSON + docx.
- **`strict` gets the same critique-revise loop.** Both modes share the same pipeline structure (draft → adversarial judge critique → revise → output). The judge persona and curator prompt differ by mode, but the pipeline path is unified. This is simpler code than branching ("if flexible then loop, else return draft"). The strategy requires `strict` not regress — the loop is a quality floor, not a mode-specific feature.

## Key Decisions

- **OVS splits by mode:** evergreen in `strict`, JD-aware thesis in `flexible`. Same Struan position (item #2), different generation behavior.
- **Existing `flexible` mechanics retained as tools:** title tailoring, grounded compression, role merging, reordering — all stay. They serve the JD-backwards competency mapping.
- **Category-based experience reorganization:** experience is grouped into JD-derived categories (e.g. "Relevant Experience" / "Other Experience" or domain-specific groupings). Strongest competency matches at the top; weak-fit roles consolidated or cut.
- **Skills section rewritten around JD needs:** skills are reorganized, reordered, and trimmed to foreground categories the JD actually asks for.
- **OVS thesis is bounded:** 2-3 sentences max, drawn only from master CV facts. Opens the CV — not a free-form narrative, a targeted framing statement.
- **JD-backwards mapping, not a fixed taxonomy.** The curator identifies transferable strengths by extracting underlying competencies from the JD, then mapping them to master CV evidence. No predefined dimension list — the mapping is specific to each JD/candidate pair.
- **Cover letter included in `flexible` response.** Pivot roles typically require one to bridge the domain gap. Generated alongside the curated CV as a markdown artifact.
- **Critique-revise loop is unified, not mode-specific.** Both `strict` and `flexible` follow the same path: draft → adversarial judge critique → revise → output. Only the curator prompt and judge persona differ by mode. Unified path is simpler code than branching.

## Prompt Sketch (CCC Adaptation)

High-level structure adapted from the Claude Project prompt to CCC's single-call API + grounding + cross-model constraints. Full implementation in planning — this is the shape, not the finished text.

```
<role>
You are a CV curator specializing in career pivots. Your job is to help a candidate
with a non-traditional background present their experience honestly for a role in an
unfamiliar domain. You identify what the JD actually needs — beneath the domain jargon —
and map those underlying competencies to verifiable evidence in the candidate's master CV.
You never invent facts, titles, metrics, or employers.
</role>

<process>
1. JD Deconstruction
   Extract the underlying competencies the role actually requires, beneath domain
   jargon. A restaurant GM JD says "manage FOH team, control COGS, drive covers" —
   the underlying competencies are people leadership, P&L ownership, operational
   throughput. Name both the domain-specific terms AND the transferable competency.

2. Competency Mapping (internal — do not emit)
   For each JD competency, find the strongest evidence in the master CV. "Led
   5-person engineering team" maps to people leadership. "Managed $2M cloud budget"
   maps to P&L ownership. Map honestly — if no evidence exists for a competency,
   note the gap rather than fabricate.

3. CV Reorganization (first draft)
   - Rewrite the OVS as a 2-3 sentence transferable-skills thesis
   - Group experience into JD-derived categories (e.g. "Operations & Management",
     "Technical Leadership") rather than chronological employer sections
   - Strongest competency matches at the top; weak-fit roles consolidated under
     "Other Experience" or cut if they add no signal
   - Rewrite skills section to foreground JD-relevant categories; consolidate
     domain-specific skills at the bottom
   - Existing flexible mechanics (title tailoring, role merging, compression)
     are available tools — use them in service of the competency mapping

4. Cover Letter (first draft)
   Write a cover letter bridging the domain gap. The CV shows competency evidence;
   the cover letter tells the story of why this pivot makes sense. Acknowledge the
   domain switch honestly; don't paper over it. Frame the career arc as deliberate
   skill-building, not a detour.

5. Adversarial Review → Revise
   Your first draft will be reviewed by an adversarial judge (experienced recruiter
   in the JD's domain). The judge will identify weaknesses: narrative gaps,
   overqualification signals, ATS keyword gaps, red flags, skepticism triggers.
   You will receive that critique and revise the CV + cover letter to address it.
   This is not optional — incorporate the feedback substantively.

6. Grounding Check (internal — do not emit)
   Verify every claim in the CV and cover letter maps to a specific fact in the
   master CV. Drop any claim you cannot source.
</process>

<curation_mode>
MODE: flexible (pivot posture)

[CROSS-REFERENCE: curation-mode.ts — existing flexible rules for title tailoring,
role merging, grounded compression, and reordering are retained; they serve the
JD-backwards competency mapping described in <process>.]
</curation_mode>

<output_format>
Return a JSON object:
{
  "curated_cv": { /* same schema as master CV, shaped per above */ },
  "cover_letter": "markdown string — cover letter text"
}
No other text before or after the JSON.
</output_format>
```

**Key differences from today's prompt:**
- JD Deconstruction + Competency Mapping steps (new — from Claude Project prompt)
- Category-based experience grouping replaces chronological employer sections (new)
- Cover letter output (new)
- Critique-revise loop (new — first draft → adversarial judge critique → curator revises; unified across both modes)
- Grounding check is explicit (exists today but reinforced)
- No `<example>` block (removed in cleanup diff — not replaced; the process steps are the guidance)

## Open Questions

0. **Critique-revise loop architecture** — The adversarial persona judge is only useful if its feedback improves the CV. Proposal: a loop where the curator produces a first draft, the judge critiques it, and the curator revises based on that feedback before returning the final output. Design decisions deferred to planning:

   - **Iterations:** Fixed (2 passes: draft → critique → revise) or dynamic (loop until judge score > threshold or max N)?
   - **Latency budget:** Each loop iteration adds a curator LLM call + judge LLM call. For a 2-pass approach: curator × 2 + judge × 1 (the judge only critiques the first draft; final output goes straight to user).
   - **Scope:** Does the loop apply to both CV and cover letter, or CV only?
   - **Judge access:** The judge needs the JD, master CV, and curator's first draft. Does it also see the Alignment Snapshot / Keyword Bank?
   - **Termination:** What if the judge's second review still finds issues? Return as-is with a note, or loop again?

1. **Single-prompt vs. two-step mapping** — The JD-backwards approach requires two mental moves: (a) extract underlying competencies from JD beneath domain jargon, (b) map those to master CV evidence. The Claude Project prompt does both in one pass (with working memory). Can CCC's curator do the same, or does it need a two-step pipeline (extract JD competencies → then curate + cover letter)? Single-prompt is simpler but risks muddling tasks; two-step is more predictable but adds latency/cost. Deferred to planning.

0. **Edge cases** — (a) JD has no transferable competencies (purely domain-specific: "5 years React Native, 3 years GraphQL"). (b) Master CV has zero evidence for any extracted JD competency — what's the fallback? (c) JD is poorly written (vague, buzzword-heavy) — can the curator extract meaningful competencies? (d) Candidate has multiple competing career tracks in master CV — does the curator pick one or surface all?

2. **What does the "transferable-skills-surfaced" judge actually measure?** The strategy names it as a new judge dimension. Proposed approach: **adversarial persona judge** — the judge adopts the persona of a highly experienced HR professional / CV coach / recruiter / ATS expert in the JD's domain. It critically reviews the curated CV + cover letter through that lens and asks: "Would I advance this candidate? What would make me reject them?"

   Persona dimensions the judge evaluates:
   - **Narrative coherence:** Does the CV + cover letter tell one clear story about why this pivot makes sense? Or does it read like two unrelated careers stapled together?
   - **Skepticism preemption:** A recruiter reviewing a domain-switcher is naturally skeptical. Does the cover letter acknowledge the domain switch honestly and frame it as deliberate, or does it paper over it?
   - **Overqualification risk:** Does the CV signal "this person will leave as soon as tech hiring picks up"? Would the recruiter see a flight risk?
   - **ATS viability:** Would keyword gaps cause this CV to be filtered before a human sees it?
   - **Red flags:** Inconsistent dates, unexplained gaps, title inflation, missing metrics — anything that would make an experienced recruiter pause.
   - **Cover letter effectiveness:** Does the cover letter actually bridge the domain gap, or is it generic enthusiasm?

   This is more subjective than a mechanical internal-consistency check — but it mirrors the actual hiring process, where a single recruiter's judgment determines whether the candidate advances. The judge doesn't need to say "is this skill transferable?" — it needs to say "as a [domain] recruiter, am I convinced?"

   **Open design question:** Should the adversarial persona be domain-specific ("you are a hospitality recruiter with 20 years experience") or generic ("you are an experienced cross-industry recruiter")? Domain-specific is more realistic but requires the judge prompt to adapt per JD. Deferred to planning.

3. **Tenure honesty guardrails** — Strategy lists this as a separate track. Is it prompt-level rules ("never sum overlapping spans"), code-level validation (detect overlapping date ranges in output), or both? This is likely a plan-phase design question.

4. **Cross-model parity testing plan** — The strategy says verify the new posture "across providers with reasoning effort pinned." What models? What sample JD/candidate pairs? What's the acceptance threshold for "parity"?

5. **Migration** — Does the new `flexible` replace the current one immediately, or does it live alongside as `flexible-v2` / a separate curation mode during testing?

## Next Steps

→ `/workflows-plan` to decompose the Pivot curation posture track into implementable units, including: prompt design for thesis OVS, judge rubric for transferable-skills-surfaced, test JDs for pivot scenarios, and cross-model verification plan.
