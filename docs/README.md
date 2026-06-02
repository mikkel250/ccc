# Docs

This directory keeps project knowledge close to the code.

## Naming

- All directories under `docs/` use kebab-case.
- All markdown file names under `docs/` use UPPER_SNAKE_CASE, including `README.md`.
- Prefer keeping individual markdown files under the configured markdown validation budgets (default 200 lines and 10,000 characters); split larger docs into focused UPPER_SNAKE_CASE files and keep `README.md` as the index/overview unless a narrow size-check exception is configured.

## Indexing

- When adding, renaming, splitting, moving, or archiving docs, update the nearest relevant `README.md` index/table of contents in the same change.
- Each docs subdirectory `README.md` acts as the local table of contents; list important files, task directories, status, and a one-line purpose for each entry.
- Start small with a single focused markdown file; when one domain grows into multiple docs, promote it to `docs/<area>/<domain>/README.md` plus related UPPER_SNAKE_CASE files in that directory.

## Map

- `spec/`: product behavior, API contracts, user-facing requirements.
- `test/`: test strategy, regression cases, manual verification notes.
- `arch/`: architecture decisions, code conventions, module boundaries, data flow, infrastructure/runtime dependencies, integration boundaries, and migration design.
- `plan/`: local active implementation plans. Create one kebab-case directory per task (`plan/<task-slug>/`), keep the task overview/index in that directory's `README.md`, and add supporting UPPER_SNAKE_CASE plan files alongside it. Ignored by git by default.
- `archive/`: local completed plans, temporary reports, historical notes, payload captures. Move completed plan task directories to `archive/plan/<task-slug>/`; put temporary reports and investigations under `archive/report/<report-slug>/`. Ignored by git by default.
