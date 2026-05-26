# Sam Struan 8-Part CV Framework

Reference for the CV tailoring API baseline output. The system prompt in `app/api/lib/cv-prompt.ts` (and Langfuse `cv-tailor-system`) instructs the model to emit this structure in strict Markdown.

## Overview

Sam Struan’s framework separates **what you tailor per application** from **what stays factual**. Most of the résumé is a stable record of roles and metrics; only the top “Relevant Accomplishments” block changes heavily for each job description. That reduces fabrication risk and keeps screening fast for recruiters.

## The eight parts (in order)

### 1. Contact Information

**Purpose:** Make you reachable and compliant without clutter.

**Include:** City and state (or region), cell/phone, email, LinkedIn. For creative or technical roles, add portfolio or GitHub when relevant. For 100% remote US roles, include location when required for tax/payroll compliance.

**Do not:** Invent contact details not in the knowledge base.

---

### 2. Objective Value Statement

**Purpose:** Answer “who is this person?” in one glance—experience depth, scope of roles, and company context.

**Answer three questions:**

1. How many years of experience?
2. What roles/responsibilities?
3. What types of companies (headcount, revenue band when known)?

**Tailoring:** Light emphasis toward the target role; all facts must come from the knowledge base.

---

### 3. Relevant Accomplishments

**Purpose:** The **primary tailoring surface** for each application—2–3 bullets or a short block that mirror the job description’s priorities.

**Why it exists:** The full experience section should remain factual and stable. Rewriting the entire CV per application invites inconsistency and hallucination.

**Tailoring:** Heavy—this is usually the only section that changes meaningfully per JD.

---

### 4. Technical Skills

**Purpose:** Keyword-rich, scannable list for ATS and technical screeners.

**Include:** Software, platforms, and technical tools (not MS Office unless the role demands it).

**Avoid:** Generic soft skills listed alone (“Communication”, “Stakeholder Management”)—they add little when not tied to outcomes.

---

### 5. Standard Job Information

**Purpose:** Unambiguous employment record for every role.

**Each role must show:**

| Field | Notes |
|--------|--------|
| Company | Legal or commonly known name |
| Title | Role held |
| Location | Where you were based |
| Dates | Include months (e.g. Apr 2021 – Apr 2022) |

Order: reverse chronological. Subheadings per employer (e.g. `### Company Name` in Markdown).

---

### 6. Company Summaries

**Purpose:** Context recruiters and hiring managers often lack—what the company does, scale, and where you sat in the org.

**Include (1–2 lines per employer when known):**

- What the company does
- Size (employees)
- Revenue (if in knowledge base)
- Geography / markets
- Division or product area (especially for large brands—e.g. which part of Google, Amazon, etc.)

**Why it matters:** One of the most overlooked résumé sections; it frames your bullets in believable scale.

---

### 7. Measurable Accomplishments

**Purpose:** Proof of impact under each role—scope, scale, and outcomes.

**Strong bullets explain:**

- Scope (what you owned)
- Impact (what changed)
- Scale (team size, volume, geography)
- Outcomes with numbers: revenue, volume, growth %, cost savings, time frames

**Tailoring:** Reorder bullets within a role for JD relevance; do not invent metrics.

---

### 8. Education (if applicable)

**Purpose:** Credentials where they matter for screening.

**When to emphasize:** Engineering, healthcare, legal, finance—sometimes move education higher or mention in the Objective Value Statement.

**When to omit:** No education data in the knowledge base—omit the section entirely (no “N/A”).

---

## Markdown mapping (API output)

| Part | Heading |
|------|---------|
| Name | `# Full Name` |
| 1–8 | `## Contact Information` … `## Education` |
| Per role | `### Company Name` under Standard Job Information / following blocks |

Forbidden in model output: HTML, tables, JSON, code fences.

## Grounding rule

Every fact must appear in `knowledge-base/` content injected as `{CONTEXT}`. The tailoring API does not invent employers, dates, metrics, or tools.

## Sync with Langfuse

Production uses Langfuse prompt `cv-tailor-system` (label: `production`). When this framework changes, update Langfuse and keep `getCvPromptFallbackText()` in `cv-prompt.ts` aligned manually.
