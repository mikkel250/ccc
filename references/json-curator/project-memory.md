# Project memory (Claude Projects port reference)

Historical Claude Projects notes. **CCC Product Contract overrides:** no page-count / overflow
QA requirement (R6c); prioritize JD-fit content over length; hard cutover without markdown
fallback after pre-checks.

---
Purpose & context

Mikkel Ridley is a San Francisco-based frontend/full-stack software engineer with approximately six years of engineering experience plus prior management and construction/field operations background. He is actively job searching for contract work, with a stated priority of landing engagements over maximizing rate. His core technical identity spans TypeScript/React/Next.js frontend work, full-stack development, and LLM/agentic AI integration. He has a rare differentiator: roughly ten years of prior construction and field operations experience (residential framing, crew leadership, project management, network infrastructure) that becomes a genuine asset for domain-specific roles like construction tech.

Key honest gaps to keep in mind across applications: no CS degree; LLM experience is integration/engineering rather than daily use of coding assistants (Claude Code, Cursor, Copilot); Google Maps integration is side-project rather than professional; SQL depth is limited and Mikkel has flagged he relies on LLM assistance for it; no direct experience with Supabase, Stripe, Replit, Lovable, n8n/Make, Airtable, or Telegram Bot API. Mikkel consistently prefers flagging real gaps honestly rather than implying coverage.

Current state

Mikkel is running a high-volume, parallel job application effort targeting contract roles across frontend, full-stack, and AI engineering tracks. Each application follows an established CV tailoring pipeline within a Claude project environment. Rate context: his floor is mid-seventies (hourly), with an opening strategy in the low-to-mid eighties range, grounded in verified prior pay history from an Alphabet-adjacent contract plus adjustment for elapsed time and new GenAI skills.

A master CV (master_cv.json) is maintained in the project and was updated during the Stensul engagement to add: HTML email layout and Klaviyo work from Kul Inc., Tessitura email template coding from SFMOMA, and independent recruiting outreach campaigns using Instantly and We-Connect. An updated file (master_cv_updated.json) was produced for Mikkel to swap back in.

Key learnings & principles

Honest gap disclosure is a stated preference: Mikkel explicitly wants gaps flagged in writing (alignment snapshots, cover notes) rather than papered over with stretched language.
CV length: Mikkel prioritizes a strong, well-fitted CV over hitting a specific page count. If trimming is needed, cut entire sections first in this order before reducing other content: Portfolio → Projects → Education → Certifications. Only after those are removed should bullets or roles be condensed.
Role retention logic: Retaining or cutting older/less-relevant roles (e.g., Marathon Products management role) should be driven by JD signal match, not default recency rules — the Marathon role has been kept in full when its documentation, training, and QA content directly matches a JD.
Blockchain/Web3 content is cut by default across nearly all applications as low-signal or irrelevant.
Intrinsic (Alphabet/Google X) is a high-value signal role and typically preserved for its monorepo/Piper/Bazel credibility.
Stealth Startups NL-to-SQL BI platform engagement is the strongest AI/agentic alignment piece and leads positioning for AI-track roles.
Skills section ordering should be driven by JD emphasis — AI/LLM category elevated for AI roles, Testing/Delivery foregrounded for SDLC-heavy roles, etc.
Rate strategy: Mikkel prioritizes landing the contract; anchoring high and visibly walking back reads as desperate and should be avoided.

Approach & patterns

The CV tailoring workflow is fully automated within the project environment and runs the same pipeline every engagement:

JD analysis → alignment snapshot (matched must-haves, nice-to-haves, honest gaps)
Author curated_cv.json from master CV with deliberate editorial decisions documented
Run resume_builder.js (Node.js, requires docx npm package) with curated JSON and output filename
Convert .docx → PDF via soffice --headless --convert-to pdf (LibreOffice)
Render PDF pages to JPEG via pdftoppm -jpeg -r 100 for visual layout verification
Copy final file to /mnt/user-data/outputs/

Working directory convention: /home/claude/[role-slug]/ per engagement. Output filename convention: Mikkel_Ridley_[RoleTitle]_[Company]_[YYYY-MM].docx.

When overflow persists across trim cycles, the reliable fix is removing entire roles or reducing multi-bullet entries to single bullets rather than shortening individual bullet text. A Python/Pillow pixel-gap measurement script has been used to quantify overflow when visual inspection is ambiguous.

Chronological ordering within the JSON must be manually verified — the builder renders entries in array order without date-sorting. The curated JSON schema supports a subroles array within experience entries (each with heading and bullets) and a top-level blurb field for company/context framing. The resume_builder.js script has been patched to gracefully handle project entries without a linkUrl field.

For recruiter-direct outreach (vs. ATS submissions), Mikkel's preference shifts toward human-readable, engaging prose over keyword-stuffing.

Tools & resources

master_cv.json — canonical CV source, maintained in project directory; master_cv_updated.json reflects Stensul-session additions
resume_builder.js — Node.js script, docx npm dependency
LibreOffice headless (soffice) — DOCX-to-PDF conversion
pdftoppm — PDF-to-JPEG page rendering for visual verification
Python/Pillow — overflow pixel measurement when needed
Underdog, LinkedIn — active job search platforms
