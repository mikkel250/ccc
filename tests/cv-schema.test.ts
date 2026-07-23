import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  validateCvJson,
  assertCuratedJsonSize,
  getCuratedJsonMaxBytes,
  __resetCvSchemaValidatorForTest,
} from "../app/api/lib/cv-schema";

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

  it("rejects experience roles that combine bullets and subroles", () => {
    const base = validCv as {
      experience: Array<Record<string, unknown>>;
    };
    const combined = {
      ...base,
      experience: [
        {
          title: "Engineer, Example",
          dates: "2024 - Present",
          bullets: ["Did a thing"],
          subroles: [{ heading: "Also", bullets: ["Nope"] }],
        },
      ],
    };
    const result = validateCvJson(combined);
    assert.equal(result.ok, false);
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
