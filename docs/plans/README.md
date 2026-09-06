# Plans

North-star for finishing CCC as a **personal in-field job-search tool** — inbound recruiter drafts plus on-demand tailor, judged by a human reading the artifacts.

`STRATEGY.md` owns product thesis and tracks. This README owns **build order and status**. Individual files in this folder are CE implementation plans; start here before opening one.

Lanes (`lfg` / `operator` / `parked` / `awaiting-merge`) mark whether drain may run `/lfg` on an outstanding row. Done milestones are not outstanding and have no lane. Drain procedure: `AGENTS.md`.

## Active milestone

**M8.2 — Gmail auth + list labeled mail** — [plan](./2026-09-06-004-feat-gmail-auth-list-plan.md). Lane: lfg

Shipped on `main`: JSON curator API, auth/rate-limit, smoke library, flexible cover-letter DOCX, LLM-judge retirement, this README.

Named leftover (not a plan): [eval-parse unit tests](../residual-review-findings/feature-retire-llm-judges.md) from the retire-judges review (GitHub #38). Lane: lfg

Operator focus (STRATEGY, not `/ce-work`): in-field `strict` submit bar. Lane: operator

Drain order (composite pick): GitHub #38, then M7, then M8.1. Inbox product contract: [inbox worker](./2026-09-05-002-feat-inbox-worker-plan.md).

## Milestones (build order)

| # | Milestone | Status | Plan | Unblocks | Lane |
|---|-----------|--------|------|----------|------|
| M1 | JSON curator API returns curated JSON + `.docx` | done | [json curator pipeline](./2026-07-20-001-feat-json-curator-cv-pipeline-plan.md) | Smoke + later surfaces | |
| M2 | MVP auth + rate limiting | done | [Upstash rate limit](./2026-06-12-feat-upstash-redis-rate-limit-plan.md), [client IP resolution](./2026-07-04-001-fix-rate-limit-client-ip-resolution-plan.md) | Safe operator/product traffic | |
| M3 | Flexible flag + cover letter; critique-revise retired | parked | [flexible posture + critique](./2026-07-27-feat-flexible-curation-posture-and-critique-loop-plan.md) — critique half superseded by [retire LLM judges](./2026-09-03-001-feat-retire-llm-judges-plan.md); STRATEGY is not investing in `flexible` as the commercial path | — | parked |
| M4 | Smoke runner library + cover-letter DOCX (no judges) | done | [entrypoint extract](./2026-07-23-refactor-extract-entrypoint-complexity-plan.md) (U3 on `main`), [cover letter DOCX](./2026-07-28-feat-smoke-cover-letter-docx-plan.md) | Operator artifact loop | |
| M5 | Retire LLM judges from tailor and smoke | done | [retire LLM judges](./2026-09-03-001-feat-retire-llm-judges-plan.md) | Single-pass tailor; human quality loop | |
| M6 | Plans README as session-start north-star | done | [plans README roadmap](./2026-09-02-001-feat-plans-readme-roadmap-plan.md) | Agents read active milestone, not newest-dated plan | |
| M7 | Cross-model parity matrix | not started | needs plan — [STRATEGY.md](../../STRATEGY.md) (production confidence across providers) | Production confidence across providers | lfg |
| M8.1 | Strict reply text on `POST /api/tailor-cv` | not started | needs plan — [STRATEGY.md](../../STRATEGY.md) “Two fronts, one API”; [inbox worker](./2026-09-05-002-feat-inbox-worker-plan.md) | Smoke yields a sendable recruiter reply plus CV artifacts | lfg |
| M8.2 | Gmail auth + list labeled mail | in progress | [gmail auth + list](./2026-09-06-004-feat-gmail-auth-list-plan.md) — product contract [inbox worker](./2026-09-05-002-feat-inbox-worker-plan.md) R6, R13, R15, R16 | Local list of recruiter-labeled messages without creating drafts | lfg |
| M8.3 | Body extract + processed-ID store | not started | needs plan — [STRATEGY.md](../../STRATEGY.md) “Two fronts, one API”; [inbox worker](./2026-09-05-002-feat-inbox-worker-plan.md) | Second extract of the same message is a no-op after the first mark | lfg |
| M8.4 | Tailor from a labeled message | not started | needs plan — [STRATEGY.md](../../STRATEGY.md) “Two fronts, one API”; [inbox worker](./2026-09-05-002-feat-inbox-worker-plan.md) | In-process strict tailor returns `.docx` and reply text without public rate-limit buckets | lfg |
| M8.5 | Thread draft + attach + body | not started | needs plan — [STRATEGY.md](../../STRATEGY.md) “Two fronts, one API”; [inbox worker](./2026-09-05-002-feat-inbox-worker-plan.md) | Local scan creates a Gmail reply draft with body and CV `.docx` | lfg |
| M8.6 | Railway schedule for the same scan job | not started | needs plan — [STRATEGY.md](../../STRATEGY.md) “Two fronts, one API”; [inbox worker](./2026-09-05-002-feat-inbox-worker-plan.md) | Deploy scans while the laptop is closed; reruns skip processed ids | lfg |

M5–M6 numbering here is the *current* board. Historical “M5 tenure honesty” / “M6 holistic smoke judge” from the first README pass are retired or parked below — do not treat those old labels as live work.

## Backlog (not active)

- **Drain-board LFG autopilot** — shipped on `main` (PR #43); procedure in `AGENTS.md`. Plan: [drain board LFG](./2026-09-05-001-feat-drain-board-lfg-plan.md). Retired as a board item.
- **Tenure honesty guardrails** — was a pivot-path milestone; no plan. Do not start while STRATEGY parks pivot/`flexible` commercial investment. Lane: parked
- **Holistic “strong enough” smoke judge** — retired. See [retire LLM judges](./2026-09-03-001-feat-retire-llm-judges-plan.md).
- **Judge model bakeoff** — [superseded](./2026-07-30-001-feat-judge-model-bakeoff-plan.md); do not implement. Lane: parked
- **Code-quality / review-todo maintenance** — [code quality hardening](./2026-06-07-code-quality-hardening.md), [close review todos](./2026-07-05-001-refactor-close-outstanding-code-review-todos-plan.md). `todos/` is a closed receipt book (filenames match YAML). Residual eval-parse tests are the named leftover. Lane: parked
- **Full product vision** — frontend, multi-user, learning system (see `docs/arch/LEARNING_SYSTEM.md`); deferred beyond the personal-tool finish line.

## How to update

- When a milestone's acceptance criteria are met, set its status to `done`, clear its Lane cell, and move **Active milestone** to the next `not started` / `in progress` item that should be focus — or state that none is in progress.
- Every outstanding row (non-`done` milestone, named leftover, operator-focus line, live backlog bullet) must have exactly one lane: `lfg`, `operator`, `parked`, or `awaiting-merge`. Use a Lane table column for milestones; `Lane: <value>` suffix for Active and backlog lines.
- Link new `/ce-plan` artifacts with repo-relative paths in this folder; use `needs plan` until a plan exists. An `lfg` `needs plan` row must name a bounded problem, a `STRATEGY.md` or this-README pointer, and a success bar (Unblocks).
- Keep product thesis in `STRATEGY.md` — do not duplicate tracks or metrics here. If STRATEGY parks a milestone (judges, pivot commercial path), update this board in the same change.
- Status and lanes are manual; do not invent automation that syncs from git.
- Drain (operator-started) iterates `lfg` rows per `AGENTS.md`. Do not rename todo files or rewrite historical plan bodies when a milestone is done.
