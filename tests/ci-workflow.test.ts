import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const WORKFLOW_PATH = join(ROOT, ".github", "workflows", "ci.yml");

function uncommentedYaml(yaml: string): string {
  return yaml
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

describe("GitHub Actions CI workflow", () => {
  it("checks out, installs, lints, tests, and builds on PRs and main", () => {
    assert.ok(
      existsSync(WORKFLOW_PATH),
      ".github/workflows/ci.yml must exist so pull requests are gated"
    );
    const yaml = uncommentedYaml(readFileSync(WORKFLOW_PATH, "utf8"));

    assert.match(yaml, /pull_request:/);
    assert.match(yaml, /push:/);
    assert.match(yaml, /\bmain\b/);
    assert.match(yaml, /node-version-file:\s*\.nvmrc/);
    assert.match(yaml, /npm ci\b/);
    assert.match(yaml, /npm run lint\b/);
    assert.match(yaml, /npm test\b/);
    assert.match(yaml, /npm run build\b/);
  });

  it("does not run live-secret jobs (smoke, Playwright, inbox Redis)", () => {
    assert.ok(existsSync(WORKFLOW_PATH), ".github/workflows/ci.yml must exist");
    const yaml = uncommentedYaml(readFileSync(WORKFLOW_PATH, "utf8"));

    assert.equal(/npm run smoke\b/.test(yaml), false);
    assert.equal(/npm run test:e2e\b/.test(yaml), false);
    assert.equal(/RUN_INBOX_REDIS_TESTS/.test(yaml), false);
    assert.equal(/TAILOR_API_KEY/.test(yaml), false);
  });

  it("limits token permissions to contents: read", () => {
    assert.ok(existsSync(WORKFLOW_PATH), ".github/workflows/ci.yml must exist");
    const yaml = uncommentedYaml(readFileSync(WORKFLOW_PATH, "utf8"));
    assert.match(yaml, /permissions:/);
    assert.match(yaml, /contents:\s*read/);
  });
});
