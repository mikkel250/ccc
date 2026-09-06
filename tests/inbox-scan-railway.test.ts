import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("Railway inbox-scan cron config", () => {
  it("keeps the API service always-on (no cronSchedule)", () => {
    const toml = read("railway.toml");
    assert.equal(/cronSchedule/i.test(toml), false);
    assert.match(toml, /startCommand\s*=\s*"npm start"/);
  });

  it("schedules the same inbox:scan job at 05:00 UTC", () => {
    const toml = read("railway.inbox-scan.toml");
    assert.match(toml, /startCommand\s*=\s*"npm run inbox:scan"/);
    assert.match(toml, /cronSchedule\s*=\s*"0 5 \* \* \*"/);
    assert.match(toml, /restartPolicyType\s*=\s*"NEVER"/);
  });

  it("keeps tsx available on production npm installs for inbox:scan", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
    };
    assert.equal(typeof pkg.dependencies?.tsx, "string");
  });
});
