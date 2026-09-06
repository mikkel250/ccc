import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function uncommentedToml(toml: string): string {
  return toml
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

describe("Railway inbox-scan cron config", () => {
  it("keeps the API service always-on (no cronSchedule)", () => {
    const toml = uncommentedToml(read("railway.toml"));
    assert.equal(/cronSchedule/i.test(toml), false);
    assert.match(toml, /startCommand\s*=\s*"npm start"/);
  });

  it("schedules the same inbox:scan job at 05:00 UTC", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    const toml = uncommentedToml(read("railway.inbox-scan.toml"));
    const start = toml.match(/startCommand\s*=\s*"npm run ([^"]+)"/);
    assert.ok(start, "inbox cron startCommand must be npm run <script>");
    const scriptName = start[1]!;
    assert.equal(scriptName, "inbox:scan");
    assert.equal(typeof pkg.scripts?.[scriptName], "string");
    assert.match(pkg.scripts![scriptName]!, /inbox-scan/);
    assert.match(toml, /cronSchedule\s*=\s*"0 5 \* \* \*"/);
    assert.match(toml, /restartPolicyType\s*=\s*"NEVER"/);
  });

  it("keeps tsx and dotenv available on production npm installs for inbox:scan", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    assert.equal(typeof pkg.dependencies?.tsx, "string");
    assert.equal(typeof pkg.dependencies?.dotenv, "string");
    assert.equal(typeof pkg.scripts?.["inbox:scan"], "string");
  });
});
