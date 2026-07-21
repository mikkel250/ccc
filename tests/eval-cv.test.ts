import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

describe("eval-cv CLI (retired)", () => {
  it("exits non-zero and points operators to smoke", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/eval-cv.ts"],
      { cwd: process.cwd(), encoding: "utf8" }
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr || result.stdout, /retired|npm run smoke/i);
  });
});
