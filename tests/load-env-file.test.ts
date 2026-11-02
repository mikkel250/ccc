import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatUnsetExports } from "../dev/load-env-file.mjs";

describe("formatUnsetExports", () => {
  it("exports only keys that are not already set", () => {
    const text = formatUnsetExports("FOO=bar\nBAZ=qux\n", { FOO: "keep" });
    assert.equal(text, "export BAZ='qux'\n");
  });

  it("skips comments and shell-unsafe keys, and quotes embedded single quotes", () => {
    const text = formatUnsetExports("# note\n1BAD=no\nFOO=a'b\n", {});
    assert.equal(text, "export FOO='a'\\''b'\n");
  });
});
