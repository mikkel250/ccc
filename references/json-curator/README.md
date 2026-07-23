# JSON curator port references

Non-PII port assets from the working Claude Projects CV curator flow.

| File | Purpose |
|------|---------|
| `master-cv.schema.json` | Structural schema for master/curated CV JSON |
| `master-cv.schema-sample.json` | Redacted sample matching the schema (no real PII) |
| `curator-prompt.md` | Struan curator prompt (adapt: JSON-only output on server) |
| `resume_builder.js` | Mechanical docx-js builder reference |
| `project-memory.md` | Sanitized curation heuristics (no candidate PII) |

**Runtime master (real PII):** Prefer `MASTER_CV_JSON` (embeds JSON in env — no filesystem copy of career PII). Alternative: `MASTER_CV_PATH` pointing at a gitignored file such as `secrets/master_cv.json` (must not be world-readable).

Do not commit real career JSON to this public repository.
