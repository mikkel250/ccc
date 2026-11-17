# Cursor portable config

Agents, commands, and skills for Cursor, kept in a standalone repo so they can be cloned into any project's .cursor directory.

## Clone into a project’s `.cursor/` (recommended)

Cloning this repo into a project’s `.cursor/` keeps it **out of your project’s git history** (most projects ignore `.cursor/`), and avoids accidentally committing it as a nested repo.

From your project root:

```bash
mkdir -p .cursor
git clone git@gitlab.com:mikkel250/utils.git .cursor/
```

To ensure it stays untracked by your project repo, add this to your project’s `.gitignore` (if it isn’t already):

```gitignore
.cursor/**
!.cursor/artifacts/
```
Note that we use the above pattern to ignore everything inside .cursor/ but still track artifacts (this is optional). If you'd rather ignore everything, just use: 
```gitignore
.cursor/
```
However, it might be helpful to have a record of how the artifacts changed over time in the repo, which is why the first pattern is recommended.

## If you clone it *inside another repo* (not recommended)

If you clone this repo anywhere inside another git repo (and that repo does **not** ignore the path), Git will treat it as a **nested repository**, which is easy to commit by accident. Prefer one of these instead:

- **Ignore the directory** in the parent repo (usually simplest): add `.cursor/` (or the specific path) to the parent `.gitignore`.
- **Use a submodule** if you *want* the parent repo to pin a specific revision:

```bash
git submodule add git@gitlab.com:mikkel250/utils.git .cursor
git submodule update --init --recursive
```

Note: if you add the submodule at `.cursor/`, that directory becomes “owned” by the submodule (so you generally wouldn’t also keep other `.cursor/*` files next to it). If you want to keep other `.cursor` content, use `.cursor/utils` instead.

## Project-local artifacts (direct clone into `.cursor/`)

This repo ships **blank templates** in `artifacts/` on the remote. After you fill them in for your project (via `RUN_ME_FIRST.md` or by hand), those files should stay **local-only** — do not push project-specific content back to `utils`.

`artifacts/` is listed in this repo's `.gitignore`, but that only affects **untracked** files. Templates committed before the ignore rule was added remain in Git's index, so local edits still show up as changes to push unless you tell Git to ignore them.

After customizing artifacts, run this from `.cursor/`:

```bash
for f in $(git ls-files artifacts/); do git update-index --skip-worktree "$f"; done
```

Git will keep the blank templates on the remote and stop tracking your local edits. Your working copies stay on disk; `git status` stays clean.

**Before pulling template updates from remote**, temporarily undo skip-worktree so Git can merge cleanly:

```bash
for f in $(git ls-files -v artifacts/ | awk '/^S/ {print $2}'); do
  git update-index --no-skip-worktree "$f"
done
git pull
# Re-apply your local content if the pull overwrote it, then re-run skip-worktree
```

If you use the **copy flow** (clone into `.cursor/utils`, copy templates to the host repo's `.cursor/artifacts/`), artifact git behavior is controlled by the **host repo** — see `QUICKSTART_README.md`.
