import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("npm test script", () => {
  it("quotes the test glob so npm passes the pattern to Node, not bash", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const testScript = pkg.scripts?.test;
    assert.equal(typeof testScript, "string");
    assert.match(
      testScript!,
      /--test\s+'tests\/\*\*\/\*\.test\.ts'/,
      "test script must quote tests/**/*.test.ts so nested tests run under npm (bash would expand to helpers only)"
    );
  });
});
