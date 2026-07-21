import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, chmodSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  validateCvJson,
  assertCuratedJsonSize,
  getCuratedJsonMaxBytes,
  __resetCvSchemaValidatorForTest,
} from "../app/api/lib/cv-schema";
import { loadMasterCv, __resetMasterCvCacheForTest } from "../app/api/lib/master-cv";

const fixturePath = join(process.cwd(), "tests/fixtures/curated-cv-valid.json");
const validCv = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;

describe("validateCvJson", () => {
  it("accepts the redacted schema sample fixture", () => {
    const result = validateCvJson(validCv);
    assert.equal(result.ok, true);
  });

  it("rejects missing required fields without embedding PII values", () => {
    const result = validateCvJson({ name: "secret-name-should-not-leak" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /schema validation/i);
      assert.equal(result.error.includes("secret-name-should-not-leak"), false);
    }
  });

  it("rejects undeclared root properties (additionalProperties)", () => {
    const result = validateCvJson({
      ...(validCv as object),
      awards: ["Fake Nobel"],
      secretNotes: "dump",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /schema validation/i);
      assert.equal(result.error.includes("Fake Nobel"), false);
    }
  });

  it("returns schema unavailable when schema file cannot be loaded", () => {
    __resetCvSchemaValidatorForTest("/nonexistent/master-cv.schema.json");
    try {
      const result = validateCvJson(validCv);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.match(result.error, /schema unavailable/i);
      }
    } finally {
      __resetCvSchemaValidatorForTest(null);
    }
  });
});

describe("assertCuratedJsonSize", () => {
  const original = process.env.TAILOR_CURATED_JSON_MAX_BYTES;

  afterEach(() => {
    if (original === undefined) delete process.env.TAILOR_CURATED_JSON_MAX_BYTES;
    else process.env.TAILOR_CURATED_JSON_MAX_BYTES = original;
  });

  it("rejects when serialized bytes exceed env max", () => {
    process.env.TAILOR_CURATED_JSON_MAX_BYTES = "10";
    // Module reads env at call time via getEnvNumber — but getCuratedJsonMaxBytes
    // is called inside assertCuratedJsonSize each time.
    const result = assertCuratedJsonSize(validCv);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /size limit/i);
    }
  });

  it("accepts under the default max", () => {
    delete process.env.TAILOR_CURATED_JSON_MAX_BYTES;
    assert.ok(getCuratedJsonMaxBytes() >= 512_000);
    assert.equal(assertCuratedJsonSize(validCv).ok, true);
  });
});

describe("loadMasterCv", () => {
  const savedJson = process.env.MASTER_CV_JSON;
  const savedPath = process.env.MASTER_CV_PATH;
  let tempDir: string | undefined;

  beforeEach(() => {
    __resetMasterCvCacheForTest();
    delete process.env.MASTER_CV_JSON;
    delete process.env.MASTER_CV_PATH;
  });

  afterEach(() => {
    if (savedJson === undefined) delete process.env.MASTER_CV_JSON;
    else process.env.MASTER_CV_JSON = savedJson;
    if (savedPath === undefined) delete process.env.MASTER_CV_PATH;
    else process.env.MASTER_CV_PATH = savedPath;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("loads valid MASTER_CV_JSON", () => {
    process.env.MASTER_CV_JSON = JSON.stringify(validCv);
    const result = loadMasterCv();
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.source, "env");
    }
  });

  it("loads from a non-world-readable path", () => {
    tempDir = mkdtempSync(join(tmpdir(), "master-cv-"));
    const path = join(tempDir, "master.json");
    writeFileSync(path, JSON.stringify(validCv), { mode: 0o600 });
    chmodSync(path, 0o600);
    process.env.MASTER_CV_PATH = path;
    const result = loadMasterCv();
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.source, "path");
    }
  });

  it("fails closed for world-readable master path", () => {
    tempDir = mkdtempSync(join(tmpdir(), "master-cv-"));
    const path = join(tempDir, "master.json");
    writeFileSync(path, JSON.stringify(validCv));
    chmodSync(path, 0o644);
    process.env.MASTER_CV_PATH = path;
    const result = loadMasterCv();
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /unavailable/i);
    }
  });

  it("fails closed when neither env nor path is set", () => {
    const result = loadMasterCv();
    assert.equal(result.ok, false);
  });

  it("prefers MASTER_CV_JSON over MASTER_CV_PATH", () => {
    process.env.MASTER_CV_JSON = JSON.stringify(validCv);
    process.env.MASTER_CV_PATH = "/nonexistent/master.json";
    const result = loadMasterCv();
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.source, "env");
    }
  });
});
