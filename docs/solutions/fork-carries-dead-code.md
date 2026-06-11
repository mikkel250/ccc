---
tags: [migrated, dead-code, git, pruning]
created: 2026-05-26
source: docs/archive/engineering-learnings.md
---

# Fork Carries Dead Code

## Problem
Assuming deleting top-level feature directories is sufficient to strip a multi-feature project. Other features' modules survive under shared `lib/` directories because there's no dead-code elimination — `git rm` doesn't know which modules lost their only consumers.

## Solution
After a structural prune, run `rg "import.*from.*'./path'"` on every survivor in shared directories to catch modules whose only consumers were the deleted features. A file-level strip is not an import-graph strip. Verify with grep or a tree-shaking tool.

## See Also
- [Original source](docs/archive/engineering-learnings.md)
