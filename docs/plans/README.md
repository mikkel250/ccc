# Plans

North-star for finishing CCC as a **personal in-field job-search tool** — inbound recruiter drafts plus on-demand tailor, judged by a human reading the artifacts.

`STRATEGY.md` owns product thesis and tracks. This README owns **build order and status**. Individual files in this folder are CE implementation plans; start here before opening one.

## Active milestone

**No in-progress implementation plan.**

Shipped on `main`: JSON curator API, auth/rate-limit, smoke library, flexible cover-letter DOCX, LLM-judge retirement, this README.

Named leftover (not a plan): [eval-parse unit tests](../residual-review-findings/feature-retire-llm-judges.md) from the retire-judges review (GitHub #38).

Operator focus (STRATEGY, not `/ce-work`): in-field `strict` submit bar.

Next engineering that needs a plan: two fronts / scheduled inbox scan (STRATEGY “Two fronts, one API”).

## Milestones (build order)

| # | Milestone | Status | Plan | Unblocks |
|---|-----------|--------|------|----------|
| M1 | JSON curator API returns curated JSON + `.docx` | done | [json curator pipeline](./2026-07-20-001-feat-json-curator-cv-pipeline-plan.md) | Smoke + later surfaces |
| M2 | MVP auth + rate limiting | done | [Upstash rate limit](./2026-06-12-feat-upstash-redis-rate-limit-plan.md), [client IP resolution](./2026-07-04-001-fix-rate-limit-client-ip-resolution-plan.md) | Safe operator/product traffic |
| M3 | Flexible flag + cover letter; critique-revise retired | parked | [flexible posture + critique](./2026-07-27-feat-flexible-curation-posture-and-critique-loop-plan.md) — critique half superseded by [retire LLM judges](./2026-09-03-001-feat-retire-llm-judges-plan.md); STRATEGY is not investing in `flexible` as the commercial path | — |
| M4 | Smoke runner library + cover-letter DOCX (no judges) | done | [entrypoint extract](./2026-07-23-refactor-extract-entrypoint-complexity-plan.md) (U3 on `main`), [cover letter DOCX](./2026-07-28-feat-smoke-cover-letter-docx-plan.md) | Operator artifact loop |
| M5 | Retire LLM judges from tailor and smoke | done | [retire LLM judges](./2026-09-03-001-feat-retire-llm-judges-plan.md) | Single-pass tailor; human quality loop |
| M6 | Plans README as session-start north-star | done | [plans README roadmap](./2026-09-02-001-feat-plans-readme-roadmap-plan.md) | Agents read active milestone, not newest-dated plan |
| M7 | Cross-model parity matrix | not started | needs plan | Production confidence across providers |
| M8 | Two fronts / scheduled inbox scan | not started | needs plan | Unattended inbound drafts on the same API |

M5–M6 numbering here is the *current* board. Historical “M5 tenure honesty” / “M6 holistic smoke judge” from the first README pass are retired or parked below — do not treat those old labels as live work.

## Backlog (not active)

- **Tenure honesty guardrails** — was a pivot-path milestone; no plan. Do not start while STRATEGY parks pivot/`flexible` commercial investment.
- **Holistic “strong enough” smoke judge** — retired. See [retire LLM judges](./2026-09-03-001-feat-retire-llm-judges-plan.md).
- **Judge model bakeoff** — [superseded](./2026-07-30-001-feat-judge-model-bakeoff-plan.md); do not implement.
- **Code-quality / review-todo maintenance** — [code quality hardening](./2026-06-07-code-quality-hardening.md), [close review todos](./2026-07-05-001-refactor-close-outstanding-code-review-todos-plan.md). `todos/` is a closed receipt book (filenames match YAML). Residual eval-parse tests are the named leftover.
- **Full product vision** — frontend, multi-user, learning system (see `docs/arch/LEARNING_SYSTEM.md`); deferred beyond the personal-tool finish line.

## How to update

- When a milestone's acceptance criteria are met, set its status to `done` and move **Active milestone** to the next `not started` / `in progress` item that should be focus — or state that none is in progress.
- Link new `/ce-plan` artifacts with repo-relative paths in this folder; use `needs plan` until a plan exists.
- Keep product thesis in `STRATEGY.md` — do not duplicate tracks or metrics here. If STRATEGY parks a milestone (judges, pivot commercial path), update this board in the same change.
- Status is manual; do not invent automation that syncs from git.
