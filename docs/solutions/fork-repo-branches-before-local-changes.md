---
tags: [migrated, git, onboarding, fork]
created: 2026-05-26
source: docs/archive/engineering-learnings.md
---

# Fork Repo: Branches Before Local Changes

## Problem
Assuming a git clone from another project is a clean starting point without auditing branches and remotes first. Once local changes are committed atop forked history, untangling old branches and remote tracking requires archiving the entire original history to a branch and creating an orphan `main` — a costly restructuring avoidable with a 5-minute audit.

## Solution
Before writing a single line of code in a forked repo:
1. Prune all upstream remotes
2. Delete unwanted branches
3. Consider an initial orphan commit (`git checkout --orphan`) to start with clean ancestry

The heuristic: "Fork → audit remotes → orphan main → first commit" is cheaper than retroactively squashing history after local work lands.

## See Also
- [Original source](docs/archive/engineering-learnings.md)
