# Project memory (Claude Projects port reference)

Historical Claude Projects notes. **CCC Product Contract overrides:** no page-count / overflow
QA requirement (R6c); prioritize JD-fit content over length; hard cutover without markdown
fallback after pre-checks.

---
Purpose & context

This repository ships a JSON curator CV pipeline: master CV JSON is curated to a JD-specific
subset, then rendered mechanically to `.docx`. Keep candidate-identifying career history,
compensation, and live job-search status out of tracked docs — those belong only in local
secrets (`MASTER_CV_JSON` / `MASTER_CV_PATH`), never in git.

Prefer honest gap disclosure in alignment notes over stretched claims. Prefer JD-fit content
over rigid page counts. When trimming is required, cut low-signal sections before condensed
bullets (typical order: Portfolio → Projects → Education → Certifications).

Key learnings & principles

- Flag real skill gaps in writing rather than implying coverage.
- Role retention should follow JD signal match, not default recency alone.
- Drop domain content that is low-signal for the target role by default.
- Preserve high-signal roles that establish credibility for the track being targeted.
- Order skills by JD emphasis (elevate categories the JD stresses).
- Rate / compensation strategy is operator-local — do not store numbers in tracked memory.

Approach & patterns

Typical curator workflow (operator tooling may differ):

1. JD analysis → alignment snapshot (matched must-haves, nice-to-haves, honest gaps)
2. Author curated CV JSON from master with deliberate editorial decisions
3. Mechanical `.docx` build from curated JSON (TypeScript builder in CCC; `resume_builder.js` is a port reference)
4. Optional local visual QA (PDF/JPEG) is out of scope for the CCC API contract

Chronological ordering within the JSON must be verified manually — builders render array order
without date-sorting. Experience entries use either `bullets[]` or `subroles[]` (exclusive).
Project entries may omit `linkUrl` / `linkLabel`; builders render a plain name heading then.

Tools & resources

- Master CV via `MASTER_CV_JSON` (preferred) or `MASTER_CV_PATH` — career PII, gitignored
- `resume_builder.js` / `json-docx-builder.ts` — mechanical docx render
- `knowledge-base/test-jds/` — sample JDs for smoke/eval fixtures
