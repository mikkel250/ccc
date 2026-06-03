# Learning System

Post-MVP system for improving CV generation quality over time via accumulated user feedback and outcome data. The primary learning target is **hallucination reduction** — style improvements are secondary.

Recommended implementation sequence: feedback capture → hallucination contrastive memory + dynamic few-shot → persona evolution. Feedback capture is a prerequisite for everything below.

## 1. Feedback Capture (prerequisite)

Every CV generation must have a feedback collection point:

- **Inline editing**: Direct text modifications to generated bullet points
- **Binary/scale ratings**: "Did the model correctly match this accomplishment to the JD intent?" (Yes/No/Partial)
- **Categorized critiques**: Tags like "overstated," "wrong metric," "missed intent," "wrong tone"

This data drives both short-term learning (few-shot examples) and long-term analysis (style rules, hallucination patterns).

## 2. Hallucination Contrastive Memory

The highest-leverage learning target. Every time the critic or manual review flags a fabrication, store it as a contrastive pair:

```
(hallucinated_claim, correct_fact_from_knowledge_base)
```

When future JDs touch the same experience area, inject into the prompt: *"Avoid: X. Use instead: Y."* This directly attacks the core quality problem and gets stronger with use. Low complexity, high leverage.

## 3. Dynamic Few-Shot Routing (short-term memory)

The easiest form of "learning" without retraining:

1. Store every approved CV bullet alongside its triggering JD requirement
2. On new JD: embed the JD intent, search the vector DB for top-3 semantically closest past JD requirements
3. Inject those approved examples into the prompt as in-context demonstrations

The model instantly mimics tone, depth, and structural mapping that was previously approved. Works well for teaching concept-specific mappings (e.g., "how to frame Kubernetes scaling experience for cloud infrastructure roles vs. platform engineering roles").

Requires: SQLite/PostgreSQL with vector extension (pgvector), or a dedicated vector store.

## 4. Persona Evolution (long-term memory)

Automated style and strategy profile that grows over time:

1. **Critique worker**: When a CV is edited or critiqued, a fast reasoning model analyzes the original vs. the edit and extracts the underlying rule
2. **Rule extraction**: e.g., "Rule 14: Never use 'spearheaded.' Rule 15: Always quantify Kubernetes scaling in pod count, not just 'high traffic.'"
3. **Profile update**: Rules appended to a permanent style profile file, injected into every system prompt

Lower priority than contrastive memory and few-shot — style fixes are polish, not correctness. Depends on having enough feedback data (weeks of use).

## 5. Callback-Based Achievement Reinforcement (phase 2+)

If the system eventually tracks which CVs lead to interview callbacks, that's the strongest possible learning signal:

- An accomplishment framed as "Led migration to microservices" might win at startups
- The same accomplishment framed as "Reduced infrastructure spend 60% by deprecating legacy monolith" might win at enterprise

Store `(JD_fingerprint, framing, outcome)` and weight similar framings higher for similar JDs. Plan the data model early — the signal accumulates over months.

## 6. Prompt Drift Detection (safety net)

Run the same canonical test JD through the pipeline on a schedule. Compare output against a golden baseline. If quality drops, something degraded — model version change, prompt drift, or knowledge base inconsistency. Essential for an unattended batch system.

## 7. Template-Based Generation (CV Cache + Diff)

Because the 8-part framework is mostly stable — only "Relevant Accomplishments" changes heavily per JD — a past approved CV can serve as a starting template:

```
1. Search vector DB for the most semantically similar past JD to the new JD
2. Retrieve the approved CV generated for that past JD
3. Feed the template CV + new JD intents → LLM diffs only the variable sections
   (Relevant Accomplishments, Objective adjustments, bullet reordering)
4. Preserve stable sections untouched (Contact Info, Standard Job Info, Education, etc.)
```

Key decisions:

- **Saves tokens**: Less input context (no full knowledge base per call if template is trusted) and less output (only diff sections, not full CV markdown)
- **Reduces hallucination surface**: Only generating the volatile sections; stable sections are guaranteed consistent
- **Template quality matters**: A mismatched template creates risk that the model stretches experience to fit rather than admitting a wrong base — the gap-noting rule from the two-pass pipeline applies here too
- **Naturally becomes a curation system**: Over time, the collection of approved CVs becomes a "greatest hits" library. The best CVs per role category (eng manager, staff IC, startup, enterprise) can be manually tagged and preferred in search

This could eventually evolve into a personal CV portfolio — a searchable library of past applications with metadata (JD type, callback outcome, framing style) rather than treating each generation as disposable.
