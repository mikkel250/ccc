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
Request flag on tailor (`curationMode`): **`strict`** (default) = keep discrete Master CV experience entries only — cut irrelevant roles, reorder remaining ones, and trim/rank bullets; no category-style collapse or invented merged titles. **`flexible`** = JD-fit-first posture (industry-agnostic): lead with strongest JD-fit roles; recency does not protect weak-fit roles; optional collapse of weak-fit clusters into category-style summaries when employer-level detail is low-value for the JD.

### Curated CV
The JD-specific JSON produced by the curator LLM: same schema as the Master CV. Shaped by curation mode — strict keeps discrete master roles (subset/reorder/trim); flexible may also collapse clusters into grounded category-style summaries. No invented metrics, tools, named employers, or certifications. Durable artifact for operator review, history, and regenerating Word output without re-tailoring.

### Mechanical render
Turning a Curated CV into a `.docx` with a deterministic builder (no LLM). The attachable file is a pure function of curated JSON plus builder version.

### Tailor request
A single `POST /api/tailor-cv` invocation that authenticates with a shared secret, validates a job description, loads the Master CV, runs the curator model, mechanically renders `.docx`, and returns the document, the Curated CV, and `builderVersion`. On the `strict` path the product also includes recruiter **reply text** (`replyText` from curator `reply_text`). Stateless per request; dual rate-limited by client IP and shared-secret hash. The inbox worker calls this pipeline in-process and must not share those HTTP rate-limit buckets.

### Builder version
Semver-like constant on the mechanical JSON→docx builder. Callers retaining curated JSON for regen must keep the recorded version; style-stable regen applies only when it matches the builder invoked (`npm run regen-docx`).

### Smoke
Manual live-API operator path (`npm run smoke`): hits a running server with Bearer auth, asserts dual artifacts, and writes redact-by-default files under `tmp/smoke/`. Strict smoke also writes recruiter reply text when the API returns it. Flexible runs also write a cover-letter DOCX only when `writeSmokeArtifacts` produces one — non-empty cover letter that passes `isValidDocxBase64`; otherwise that file may be absent. Quality is the operator reading those files. Not part of `npm test` / CI.

### Parity smoke
Operator loop (`npm run smoke:parity` / `--parity`) that fills **one** `SMOKE_PARITY_MODELS` cell per process against the running server’s `TAILOR_MODEL`. Artifacts nest under `tmp/smoke/<provider>/<model>/`; `parity-status.json` lists filled vs pending cells. Remaining cells require a server restart — not a request-body model picker. Still no judges.

### Knowledge base
*Avoid as the name for career truth after cutover — use Master CV.* Historically: on-disk markdown career corpus injected into every tailor request. Retained only as a legacy term for pre-cutover behavior and non-tailor prose / test JD fixtures under `knowledge-base/test-jds/`.

## Inbox

### Reply text
The recruiter-facing email body returned on a successful `strict` tailor. Curator JSON key `reply_text`; HTTP and in-process result field `replyText`. Grounded in the Master CV with the same no-invention rules as the Curated CV. The inbox worker copies it into the Gmail draft body. Distinct from flexible-mode `coverLetter`.

### Inbox scan
On-demand or scheduled job in this process: list Gmail messages with the recruiter label, skip claimed or processed ids, strict-tailor the body in-process, create a thread reply draft with reply text and the CV `.docx`. Local `npm run inbox:scan` and Railway cron invoke the same job.

### Processed message
A Gmail `messageId` in its terminal Redis state: a sendable reply draft already exists, so a later scan (local or Railway) does not tailor or create another draft. The worker claims the id before drafting and writes this mark only after draft success. Overlap and crash recovery live in the inbox-worker product contract (R10, R12, F3).

## Agent workflow

### LFG lane
A label on a `docs/plans/README.md` row that says whether drain may run `/lfg` on it: **`lfg`** (agent-executable), **`operator`** (human quality work such as the in-field submit bar), **`parked`** (STRATEGY not-working-on or deferred bets), **`awaiting-merge`** (CodeRabbit-clean PR, operator has not merged yet).

### Drain
Operator-started iteration over `lfg` rows until none remain. Procedure lives only in `AGENTS.md` (**Drain**). Halt with an empty `lfg` set is success. Not a background daemon.

### Composite pick
Next Drain job: README `lfg` rows in board order, minus rows that already have an open drain PR identified by the `Drain-row:` join key.

### Babysit-clean
Drain's CodeRabbit-clean bar: babysit pipeline success (CI clean, merge state CLEAN, no actionable babysit backlog). `/lfg` DONE is not sufficient.
