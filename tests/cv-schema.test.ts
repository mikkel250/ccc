import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  validateCvJson,
  assertCuratedJsonSize,
  getCuratedJsonMaxBytes,
  __clearCvSchemaCacheForTest,
} from "../app/api/lib/cv-schema";

const fixturePath = join(process.cwd(), "tests/fixtures/curated-cv-valid.json");
const validCv = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;
const shippedSchemaPath = join(
  process.cwd(),
  "references",
  "json-curator",
  "master-cv.schema.json"
);

describe("validateCvJson", () => {
  const originalCvSchemaPath = process.env.CV_SCHEMA_PATH;

  afterEach(() => {
    if (originalCvSchemaPath === undefined) delete process.env.CV_SCHEMA_PATH;
    else process.env.CV_SCHEMA_PATH = originalCvSchemaPath;
    __clearCvSchemaCacheForTest();
  });

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
    if (!result.ok) {
      assert.match(result.error, /\/experience\/0/);
      assert.match(result.error, /oneOf/i);
    }
  });

  // Curator output contract boundary (validateCvJson / master-cv.schema.json).
  it("accepts summary as string[], comma-separated skills[].items, and experience with bullets", () => {
    const result = validateCvJson({
      ...(validCv as object),
      summary: [
        "Transferable-skills thesis sentence one.",
        "Supporting sentence two.",
      ],
      skills: [
        {
          category: "Operations",
          items: "Stakeholder alignment, budget ownership, scaling",
        },
      ],
      experience: [
        {
          title: "Lead, Example Org",
          dates: "2020 - 2024",
          bullets: ["Led a cross-functional program through growth."],
        },
      ],
    });
    assert.equal(result.ok, true);
  });

  it("accepts experience entries that use subroles instead of bullets", () => {
    const result = validateCvJson({
      ...(validCv as object),
      experience: [
        {
          title: "Engineer, Example",
          dates: "2024 - Present",
          subroles: [{ heading: "Platform", bullets: ["Owned APIs"] }],
        },
      ],
    });
    assert.equal(result.ok, true);
  });

  it("rejects summary as a bare string instead of string[]", () => {
    const result = validateCvJson({
      ...(validCv as object),
      summary: "Bare thesis string that should be an array",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /\/summary must be array/);
    }
  });

  it("rejects skills[].items when it is a string array instead of a comma-separated string", () => {
    const base = validCv as {
      skills: Array<{ category: string; items: string }>;
    };
    const result = validateCvJson({
      ...base,
      skills: [
        {
          category: "Core",
          items: ["TypeScript", "Node"] as unknown as string,
        },
      ],
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /\/skills\/0\/items must be string/);
    }
  });

  it("rejects experience entries that include undeclared properties like company", () => {
    const base = validCv as {
      experience: Array<Record<string, unknown>>;
    };
    const result = validateCvJson({
      ...base,
      experience: [
        {
          title: "Engineer, Example",
          dates: "2024 - Present",
          company: "Example Co",
          bullets: ["Did a thing"],
        },
      ],
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(
        result.error,
        /\/experience\/0 must NOT have additional properties/
      );
    }
  });

  it("rejects experience entries missing both bullets and subroles", () => {
    const result = validateCvJson({
      ...(validCv as object),
      experience: [{ title: "Engineer, Example", dates: "2024 - Present" }],
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /\/experience\/0/);
      assert.match(result.error, /oneOf/i);
    }
  });

  it("loads schema from CV_SCHEMA_PATH when set to a valid path", () => {
    process.env.CV_SCHEMA_PATH = shippedSchemaPath;
    __clearCvSchemaCacheForTest();
    const result = validateCvJson(validCv);
    assert.equal(result.ok, true);
  });

  it("trims whitespace from CV_SCHEMA_PATH before loading", () => {
    process.env.CV_SCHEMA_PATH = `  ${shippedSchemaPath}  `;
    __clearCvSchemaCacheForTest();
    const result = validateCvJson(validCv);
    assert.equal(result.ok, true);
  });

  it("returns schema unavailable when schema file cannot be loaded", () => {
    process.env.CV_SCHEMA_PATH = "/nonexistent/master-cv.schema.json";
    __clearCvSchemaCacheForTest();
    const result = validateCvJson(validCv);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /schema unavailable/i);
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
