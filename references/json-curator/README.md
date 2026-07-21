# JSON curator port references

Non-PII port assets from the working Claude Projects CV curator flow.

| File | Purpose |
|------|---------|
| `master-cv.schema.json` | Structural schema for master/curated CV JSON |
| `master-cv.schema-sample.json` | Redacted sample matching the schema (no real PII) |
| `curator-prompt.md` | Struan curator prompt (adapt: JSON-only output on server) |
| `resume_builder.js` | Mechanical docx-js builder reference |
| `project-memory.md` | Curation heuristics (honest gaps, cut order, multi-track) |

**Runtime master (real PII):** `secrets/master_cv.json` (gitignored). Configure via `MASTER_CV_PATH`.

Do not commit real career JSON to this public repository.
