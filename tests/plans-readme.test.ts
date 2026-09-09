import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const README_PATH = path.join(process.cwd(), "docs", "plans", "README.md");

/**
 * Strip optional Markdown title and URL fragment from a link destination.
 * e.g. `./plan.md#section "title"` → `./plan.md`
 */
function cleanLinkDestination(raw: string): string {
  let dest = raw.trim();
  const titleMatch = dest.match(/\s+["']/);
  if (titleMatch?.index != null) {
    dest = dest.slice(0, titleMatch.index).trim();
  }
  const hashIdx = dest.indexOf("#");
  if (hashIdx !== -1) {
    dest = dest.slice(0, hashIdx).trim();
  }
  return dest;
}

/** Markdown links to plan files under docs/plans/ (repo-relative or same-dir). */
function extractPlanLinks(markdown: string): string[] {
  const links: string[] = [];
  const re = /\[([^\]]*)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    const href = cleanLinkDestination(match[2]);
    if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("#") || href === "") {
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

const LANES = ["lfg", "operator", "parked", "awaiting-merge"] as const;
const LANE_TOKEN = /Lane:\s*(lfg|operator|parked|awaiting-merge)/;

function splitTableRow(line: string): string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

/** Non-done milestone rows that must carry a Lane cell. */
function outstandingMilestoneRows(markdown: string): { id: string; lane: string }[] {
  return allMilestoneRows(markdown)
    .filter((row) => row.status !== "done")
    .map((row) => ({ id: row.id, lane: row.lane }));
}

function requireLaneToken(line: string, label: string): string {
  const match = line.match(LANE_TOKEN);
  assert.ok(match, `${label} must include a Lane: token`);
  return match[1];
}

function allMilestoneRows(
  markdown: string
): { id: string; status: string; plan: string; unblocks: string; lane: string }[] {
  const lines = markdown.split("\n");
  const headerIdx = lines.findIndex((line) => line.includes("| # |") && line.includes("Lane"));
  if (headerIdx === -1) {
    throw new Error("milestones table must include a Lane column");
  }
  const headers = splitTableRow(lines[headerIdx]).map((h) => h.toLowerCase());
  const statusIdx = headers.indexOf("status");
  const laneIdx = headers.indexOf("lane");
  const idIdx = headers.indexOf("#");
  const planIdx = headers.indexOf("plan");
  const unblocksIdx = headers.indexOf("unblocks");
  if (statusIdx === -1 || laneIdx === -1 || idIdx === -1 || planIdx === -1 || unblocksIdx === -1) {
    throw new Error("milestones table must have #, Status, Plan, Unblocks, and Lane columns");
  }
  const rows: { id: string; status: string; plan: string; unblocks: string; lane: string }[] = [];
  for (const line of lines.slice(headerIdx + 2)) {
    if (!line.startsWith("|")) break;
    const cells = splitTableRow(line);
    rows.push({
      id: cells[idIdx] ?? "",
      status: cells[statusIdx] ?? "",
      plan: cells[planIdx] ?? "",
      unblocks: cells[unblocksIdx] ?? "",
      lane: cells[laneIdx] ?? "",
    });
  }
  return rows;
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

  it("normalizes fragments and optional titles before plan-link checks", () => {
    const md = [
      "[a](./alpha-plan.md#section)",
      '[b](./beta-plan.md "Beta title")',
      "[c](docs/plans/gamma-plan.md#x 'Gamma')",
      "[skip](./README.md#top)",
    ].join("\n");
    assert.deepEqual(extractPlanLinks(md), [
      "docs/plans/alpha-plan.md",
      "docs/plans/beta-plan.md",
      "docs/plans/gamma-plan.md",
    ]);
  });

  it("gives every outstanding milestone row exactly one valid lane", () => {
    const content = fs.readFileSync(README_PATH, "utf-8");
    const rows = outstandingMilestoneRows(content);
    assert.ok(rows.length > 0, "expected at least one outstanding (non-done) milestone");
    for (const row of rows) {
      assert.ok(
        (LANES as readonly string[]).includes(row.lane),
        `outstanding row ${row.id} has illegal or missing lane ${JSON.stringify(row.lane)}`
      );
    }
  });

  it("lanes the named leftover and operator-focus lines in Active", () => {
    const content = fs.readFileSync(README_PATH, "utf-8");
    const leftover = content.split("\n").find((line) => line.includes("GitHub #38"));
    assert.ok(leftover, "Active must name leftover GitHub #38");
    assert.equal(requireLaneToken(leftover, "leftover #38"), "awaiting-merge");
    const operator = content.split("\n").find((line) => line.includes("submit bar"));
    assert.ok(operator, "Active must name the in-field submit bar");
    assert.equal(requireLaneToken(operator, "submit bar"), "operator");
  });

  it("lanes outstanding backlog bullets that are not retired or omitted", () => {
    const content = fs.readFileSync(README_PATH, "utf-8");
    const backlogStart = content.indexOf("## Backlog");
    const howToStart = content.indexOf("## How to update");
    assert.ok(backlogStart !== -1 && howToStart !== -1, "Backlog and How to update headings required");
    const backlog = content.slice(backlogStart, howToStart);
    const bullets = backlog.split("\n").filter((line) => line.startsWith("- "));
    assert.ok(bullets.length > 0, "Backlog must have bullets");
    for (const bullet of bullets) {
      if (/retired|deferred beyond the personal-tool finish line/i.test(bullet)) {
        continue;
      }
      const lane = requireLaneToken(bullet, bullet.slice(0, 48));
      assert.ok((LANES as readonly string[]).includes(lane), `illegal backlog lane ${lane}`);
    }
  });

  it("gives lfg needs-plan milestone rows a STRATEGY or README pointer", () => {
    const content = fs.readFileSync(README_PATH, "utf-8");
    const needsPlanLfg = allMilestoneRows(content).filter(
      (row) => row.status !== "done" && row.lane === "lfg" && /needs plan/i.test(row.plan)
    );
    assert.ok(needsPlanLfg.length > 0, "expected at least one lfg needs-plan milestone");
    for (const row of needsPlanLfg) {
      const blob = `${row.plan} ${row.unblocks}`;
      assert.ok(
        /STRATEGY\.md|docs\/plans\/README/i.test(blob),
        `lfg needs-plan row ${row.id} must point at STRATEGY.md or docs/plans/README`
      );
    }
  });
});
