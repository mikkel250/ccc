import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const README_PATH = path.join(process.cwd(), "docs", "plans", "README.md");

/** Markdown links to plan files under docs/plans/ (repo-relative or same-dir). */
function extractPlanLinks(markdown: string): string[] {
  const links: string[] = [];
  const re = /\[([^\]]*)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    const href = match[2].trim();
    if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("#")) {
      continue;
    }
    const normalized = href.replace(/^\.\//, "");
    if (
      normalized === "README.md" ||
      normalized.endsWith("/README.md") ||
      normalized === "docs/plans/README.md"
    ) {
      continue;
    }
    if (normalized.endsWith(".md") && (normalized.startsWith("docs/plans/") || !normalized.includes("/"))) {
      links.push(normalized.startsWith("docs/plans/") ? normalized : `docs/plans/${normalized}`);
    }
  }
  return [...new Set(links)];
}

describe("docs/plans/README.md — cross-file contracts", () => {
  it("exists and names an Active milestone", () => {
    assert.ok(fs.existsSync(README_PATH), "docs/plans/README.md must exist");
    const content = fs.readFileSync(README_PATH, "utf-8");
    assert.ok(
      content.includes("Active milestone"),
      "docs/plans/README.md must contain 'Active milestone'"
    );
  });

  it("links only to plan files that exist on disk", () => {
    assert.ok(fs.existsSync(README_PATH), "docs/plans/README.md must exist");
    const content = fs.readFileSync(README_PATH, "utf-8");
    const links = extractPlanLinks(content);
    assert.ok(links.length > 0, "README must link to at least one plan file");
    for (const rel of links) {
      const abs = path.join(process.cwd(), rel);
      assert.ok(fs.existsSync(abs), `broken plan link: ${rel}`);
    }
  });
});
