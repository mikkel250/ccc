# Residual Review Findings

Branch: `feature/retire-llm-judges`
Plan: `docs/plans/2026-09-03-001-feat-retire-llm-judges-plan.md`
Review run: `/tmp/compound-engineering-501/ce-code-review/20260903-123627-a5b44e32`

Eligible review-followup applies were skipped: remaining actionable items are single-reviewer / historical-eval cleanup.

## Residual Review Findings

- P2 `app/api/lib/eval-schema.ts:111` — Zombie JUDGE_MAP remains for historical seed-eval — https://github.com/mikkel250/ccc/issues/37
- P2 `app/api/lib/eval-parse.ts:5` — Dedicated eval-parse unit tests were deleted with eval-judge — https://github.com/mikkel250/ccc/issues/38

### Settled-conflict (report-only; do not revert)

- P1 Smoke CLI no longer fails on judge gates — conflicts with KTD2 (drop smoke judge gates). Routed advisory.
- P1 `verifySmokePipeline` signature dropped master/judge fields — conflicts with KTD2. In-repo callers updated.
- P1 `CRITIQUE_REVISE_ENABLED` is ignored — conflicts with KTD1 (do not keep a flag that can turn the loop on).

## Source run context

- Reviewers: correctness, project-standards, testing, maintainability, api-contract, reliability, agent-native, learnings
- Cross-model adversarial: Claude Opus high requested; peer produced no usable output (`error: unknown option '--effort'`)
