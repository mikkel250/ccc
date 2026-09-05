# Plans

North-star for finishing CCC as a **personal pivot job-search tool** — a curated CV (and related artifacts) strong enough to submit for unfamiliar target domains.

`STRATEGY.md` owns product thesis and tracks. This README owns **build order and status**. Individual files in this folder are CE implementation plans; start here before opening one.

## Active milestone

**M4 — Smoke runner modular + live-API judges** (`in progress`)

Outcome: operator can run a modular live-API smoke path with judges (and cover-letter DOCX when flexible), so quality loops are reliable before more pivot eval work.

Plans:

- [Extract entrypoint complexity (smoke U3)](./2026-07-23-refactor-extract-entrypoint-complexity-plan.md)
- [Flexible smoke cover letter DOCX](./2026-07-28-feat-smoke-cover-letter-docx-plan.md)

Why active: smoke modularization is the current focus and unblocks bakeoff / parity work that depends on a reusable smoke path.

## Milestones (build order)

| # | Milestone | Status | Plan | Unblocks |
|---|-----------|--------|------|----------|
| M1 | JSON curator API returns curated JSON + `.docx` | done | [json curator pipeline](./2026-07-20-001-feat-json-curator-cv-pipeline-plan.md) | Smoke + flexible curation |
| M2 | MVP auth + rate limiting | done | [Upstash rate limit](./2026-06-12-feat-upstash-redis-rate-limit-plan.md), [client IP resolution](./2026-07-04-001-fix-rate-limit-client-ip-resolution-plan.md) | Safe operator/product traffic |
| M3 | Flexible pivot curation posture + critique loop | in progress | [flexible posture + critique](./2026-07-27-feat-flexible-curation-posture-and-critique-loop-plan.md) | Submit-worthy pivot CVs |
| M4 | Smoke runner modular + live-API judges | in progress | [entrypoint extract](./2026-07-23-refactor-extract-entrypoint-complexity-plan.md), [cover letter DOCX](./2026-07-28-feat-smoke-cover-letter-docx-plan.md) | Operator quality loop |
| M5 | Tenure honesty guardrails | not started | needs plan | Credibility floor for pivot CVs |
| M6 | Holistic "strong enough" smoke judge | not started | needs plan (STRATEGY judge coverage) | Pivot success signal |
| M7 | Cross-model parity matrix | not started | needs plan | Production confidence across providers |

## Backlog (STRATEGY tracks, not active)

Not on the critical path for the personal pivot finish line right now:

- **Judge model bakeoff** — [requirements-only plan](./2026-07-30-001-feat-judge-model-bakeoff-plan.md); parked until smoke modularization lands.
- **Code-quality / review-todo maintenance** — [code quality hardening](./2026-06-07-code-quality-hardening.md), [close review todos](./2026-07-05-001-refactor-close-outstanding-code-review-todos-plan.md).
- **Full product vision** — frontend, multi-user, learning system (see `docs/arch/LEARNING_SYSTEM.md`); deferred beyond personal-tool finish line.

## How to update

- When a milestone's acceptance criteria are met, set its status to `done` and move **Active milestone** to the next `not started` / `in progress` item that should be focus.
- Link new `/ce-plan` artifacts with repo-relative paths in this folder; use `needs plan` until a plan exists.
- Keep product thesis in `STRATEGY.md` — do not duplicate tracks or metrics here.
- Status is manual; do not invent automation that syncs from git.
