import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mergeParityStatus,
  parseSmokeParityModels,
  pendingParityModels,
  redactCuratedForArtifact,
  shouldWriteCoverLetterDocx,
  smokeArtifactPaths,
  smokeParityArtifactDir,
} from "../app/api/lib/smoke-helpers";

const MASTER = {
  name: "JANE EXAMPLE",
  contact: {
    location: "Example City, ST",
    phone: "+1-555-0100",
    email: "jane@example.com",
    links: [],
  },
  summary: ["Evergreen"],
  experience: [
    {
      title: "Engineer, Example Corp",
      bullets: ["Shipped React feature"],
    },
  ],
};

describe("redactCuratedForArtifact", () => {
  it("strips contact and free-text bullets", () => {
    const redacted = redactCuratedForArtifact(MASTER) as {
      contact: { redacted?: boolean };
      summary: string[];
      experience: Array<{ bullets: string[] }>;
    };
    assert.equal(redacted.contact.redacted, true);
    assert.deepEqual(redacted.summary, ["[REDACTED]"]);
    assert.deepEqual(redacted.experience[0]!.bullets, ["[REDACTED]"]);
  });
});

describe("shouldWriteCoverLetterDocx", () => {
  it("returns true for flexible mode with non-empty string", () => {
    assert.equal(shouldWriteCoverLetterDocx("flexible", "Dear hiring manager..."), true);
  });

  it("returns false for flexible mode with empty string", () => {
    assert.equal(shouldWriteCoverLetterDocx("flexible", ""), false);
  });

  it("returns false for flexible mode with whitespace-only string", () => {
    assert.equal(shouldWriteCoverLetterDocx("flexible", "   "), false);
  });

  it("returns false for flexible mode with missing coverLetter (undefined)", () => {
    assert.equal(shouldWriteCoverLetterDocx("flexible", undefined), false);
  });

  it("returns false for flexible mode with null coverLetter", () => {
    assert.equal(shouldWriteCoverLetterDocx("flexible", null), false);
  });

  it("returns false for strict mode even with non-empty string", () => {
    assert.equal(shouldWriteCoverLetterDocx("strict", "Dear hiring manager..."), false);
  });

  it("returns false for strict mode with empty string", () => {
    assert.equal(shouldWriteCoverLetterDocx("strict", ""), false);
  });

  it("returns false when coverLetter is not a string (number)", () => {
    assert.equal(shouldWriteCoverLetterDocx("flexible", 123 as unknown), false);
  });

  it("returns false when coverLetter is an object", () => {
    assert.equal(shouldWriteCoverLetterDocx("flexible", {} as unknown), false);
  });
});

describe("smokeArtifactPaths", () => {
  it("names docx and curated json from the JD basename", () => {
    const paths = smokeArtifactPaths(
      "/Users/me/knowledge-base/test-jds/smoke/wayfare-mgr.md",
      "/tmp/smoke"
    );
    assert.equal(paths.slug, "wayfare-mgr");
    assert.equal(paths.docxPath, "/tmp/smoke/wayfare-mgr.docx");
    assert.equal(paths.curatedPath, "/tmp/smoke/wayfare-mgr.curated.json");
    assert.equal(
      paths.coverLetterPath,
      "/tmp/smoke/wayfare-mgr.cover-letter.docx"
    );
  });

  it("strips the terminal extension and sanitizes unsafe characters", () => {
    const paths = smokeArtifactPaths("Weird JD Name!!.MD", "/out");
    assert.equal(paths.slug, "Weird-JD-Name");
    assert.equal(paths.docxPath, "/out/Weird-JD-Name.docx");
    assert.equal(
      paths.coverLetterPath,
      "/out/Weird-JD-Name.cover-letter.docx"
    );
  });

  it("does not produce a double extension for a non-Markdown input", () => {
    const paths = smokeArtifactPaths("source.docx", "/out");
    assert.equal(paths.slug, "source");
    assert.equal(paths.docxPath, "/out/source.docx");
    assert.equal(
      paths.coverLetterPath,
      "/out/source.cover-letter.docx"
    );
  });

  it("nests under provider/model segments when model is passed", () => {
    const paths = smokeArtifactPaths("wayfare-mgr.md", "/tmp/smoke", "anthropic/sonnet");
    assert.equal(paths.docxPath, "/tmp/smoke/anthropic/sonnet/wayfare-mgr.docx");
    assert.equal(
      paths.curatedPath,
      "/tmp/smoke/anthropic/sonnet/wayfare-mgr.curated.json"
    );
  });
});

describe("parseSmokeParityModels", () => {
  const previous = process.env.SMOKE_PARITY_MODELS;

  afterEach(() => {
    if (previous === undefined) delete process.env.SMOKE_PARITY_MODELS;
    else process.env.SMOKE_PARITY_MODELS = previous;
  });

  it("defaults to MODEL_SELECTION production slugs when env is unset", () => {
    delete process.env.SMOKE_PARITY_MODELS;
    const models = parseSmokeParityModels();
    assert.deepEqual(models, [
      "anthropic/sonnet",
      "deepseek/deepseek-v4-pro",
      "openrouter/openai/gpt-5.4-mini",
      "openrouter/google/gemini-3.1-pro-preview",
    ]);
  });

  it("parses an override CSV", () => {
    const models = parseSmokeParityModels(
      "deepseek/deepseek-v4-pro, anthropic/sonnet"
    );
    assert.deepEqual(models, ["deepseek/deepseek-v4-pro", "anthropic/sonnet"]);
  });

  it("throws on a bare alias", () => {
    assert.throws(() => parseSmokeParityModels("sonnet"), /provider\/model|Invalid model/i);
  });

  it("throws on an unknown provider", () => {
    assert.throws(() => parseSmokeParityModels("cohere/command-r"), /Unknown provider/i);
  });
});

describe("smokeParityArtifactDir", () => {
  it("joins provider segments under the smoke root", () => {
    assert.equal(
      smokeParityArtifactDir("/tmp/smoke", "openrouter/openai/gpt-5.4-mini"),
      "/tmp/smoke/openrouter/openai/gpt-5.4-mini"
    );
  });

  it("rejects path-traversal model segments", () => {
    assert.throws(
      () => smokeParityArtifactDir("/tmp/smoke", "anthropic/../etc"),
      /Invalid model/
    );
  });
});

describe("mergeParityStatus", () => {
  it("fills one cell and leaves other catalog models pending", () => {
    const catalog = ["anthropic/sonnet", "deepseek/deepseek-v4-pro"];
    const status = mergeParityStatus(null, catalog, "anthropic/sonnet", true);
    assert.equal(status.cells["anthropic/sonnet"]?.ok, true);
    assert.deepEqual(pendingParityModels(catalog, status), [
      "deepseek/deepseek-v4-pro",
    ]);
  });
});
