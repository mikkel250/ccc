import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evalResultsArtifactsPresent } from "./eval-results";

describe("evalResultsArtifactsPresent", () => {
  it("is false when the directory is missing", () => {
    const missing = path.join(
      os.tmpdir(),
      `ccc-eval-missing-${Date.now()}-${process.pid}`
    );
    assert.equal(evalResultsArtifactsPresent(missing), false);
  });

  it("is false when the directory is empty", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-eval-empty-"));
    try {
      assert.equal(evalResultsArtifactsPresent(dir), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is true when a JD subdirectory exists", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-eval-present-"));
    try {
      fs.mkdirSync(path.join(dir, "frontend-developer"));
      assert.equal(evalResultsArtifactsPresent(dir), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
