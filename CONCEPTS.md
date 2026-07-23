# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Observability

### Tracer
A backend-specific adapter that records one LLM call outcome. Every Tracer shares one payload shape and is enabled independently; `chat()` dispatches to each enabled Tracer without knowing vendor APIs.

LangSmith stays off the request-critical path (fire-and-forget). Langfuse stays on it (awaited) so immediate export can finish before a short-lived serverless handler freezes.

### TracePayload
The single serializable description of an LLM call passed to every Tracer: provider, model, messages, system prompt, response, timing, and trace-safe options. Injectable SDK clients are stripped before options enter the payload so test doubles cannot leak into vendor exports. May also carry an optional Langfuse prompt reference for version linking.

## CV tailoring

### Master CV
The canonical structured career record for the seeker — one complete record spanning industries and eras, kept granular so every era is available to curate from. Multi-industry targeting uses this single master, not parallel masters. After the JSON-curator cutover, the master is JSON — not the legacy markdown knowledge-base corpus used as tailor context.

### Curation mode
Request flag on tailor (`curationMode`): **`strict`** (default) = Struan subset only — cut/reorder/trim discrete roles, no category-style collapse. **`flexible`** = JD-fit-first posture (industry-agnostic): lead with strongest JD-fit roles; recency does not protect weak-fit roles; optional collapse of weak-fit clusters into category-style summaries when employer-level detail is low-value for the JD.

### Curated CV
The JD-specific JSON produced by the curator LLM: same schema as the Master CV. Shaped by curation mode — strict keeps discrete master roles (subset/reorder/trim); flexible may also collapse clusters into grounded category-style summaries. No invented metrics, tools, named employers, or certifications. Durable artifact for judging, history, and regenerating Word output without re-tailoring.

### Mechanical render
Turning a Curated CV into a `.docx` with a deterministic builder (no LLM). The attachable file is a pure function of curated JSON plus builder version.

### Tailor request
A single `POST /api/tailor-cv` invocation that authenticates with a shared secret, validates a job description, loads the Master CV, runs the curator model, mechanically renders `.docx`, and returns both the document and the Curated CV (plus `builderVersion`). Stateless per request; dual rate-limited by client IP and shared-secret hash.

### Builder version
Semver-like constant on the mechanical JSON→docx builder. Callers retaining curated JSON for regen must keep the recorded version; style-stable regen applies only when it matches the builder invoked (`npm run regen-docx`).

### Smoke
Manual live-API operator path (`npm run smoke`): hits a running server with Bearer auth, asserts dual artifacts, always runs grounding + JD-fit judges on master + curated + JD. Not part of `npm test` / CI.

### Knowledge base
*Avoid as the name for career truth after cutover — use Master CV.* Historically: on-disk markdown career corpus injected into every tailor request. Retained only as a legacy term for pre-cutover behavior and non-tailor prose / test JD fixtures under `knowledge-base/test-jds/`.
