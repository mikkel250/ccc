import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseEvalModels } from "../scripts/eval-cv";

const EVAL_RESULTS_DIR = path.join(process.cwd(), "eval-results");
const ENV_EXAMPLE_PATH = path.join(process.cwd(), ".env.example");
const ENV_TS_PATH = path.join(process.cwd(), "lib", "env.ts");
const TEST_JDS_DIR = path.join(process.cwd(), "knowledge-base", "test-jds");

/** provider/model — first segment must not contain `/` */
const NAMESPACED_MODEL_RE = /^[^/\s]+\/.+/;

function readTailorModelFromEnvExample(): string {
  const content = fs.readFileSync(ENV_EXAMPLE_PATH, "utf-8");
  const match = content.match(/^TAILOR_MODEL=(.+)$/m);
  assert.ok(match, "TAILOR_MODEL must be defined in .env.example");
  return match[1]!.trim();
}

function readDefaultTailorModelFromEnvTs(): string {
  const content = fs.readFileSync(ENV_TS_PATH, "utf-8");
  const match = content.match(
    /const DEFAULT_TAILOR_MODEL\s*=\s*['"]([^'"]+)['"]/
  );
  assert.ok(match, "DEFAULT_TAILOR_MODEL must be defined in lib/env.ts");
  return match[1]!;
}

function listTestJdSlugs(): string[] {
  if (!fs.existsSync(TEST_JDS_DIR)) return [];
  return fs
    .readdirSync(TEST_JDS_DIR)
    .filter((name) => name.endsWith(".md"))
    .map((name) => path.basename(name, ".md"));
}

function modelToDirSegment(model: string): string {
  return model.replace(/\//g, path.sep);
}

function computeCompositeScore(scores: {
  format: { score: number };
  relevance: { score: number };
  hallucination: { score: number };
  extraction: { score: number };
}): number {
  return (
    (scores.format.score +
      scores.relevance.score / 5 +
      (1 - scores.hallucination.score) +
      scores.extraction.score) /
    4
  );
}

describe("eval-results — post-evaluation artifacts", () => {
  it("eval-results/ contains scores.json for every JD×model pair", () => {
    const slugs = listTestJdSlugs();
    const models = parseEvalModels();
    assert.ok(slugs.length >= 2, "test JDs must exist before evaluating results");
    assert.ok(models.length >= 2, "eval models must be configured");

    for (const slug of slugs) {
      for (const model of models) {
        const scoresPath = path.join(
          EVAL_RESULTS_DIR,
          slug,
          modelToDirSegment(model),
          "scores.json"
        );
        assert.ok(
          fs.existsSync(scoresPath),
          `missing scores.json for ${slug} × ${model} at ${scoresPath}`
        );
        const scores = JSON.parse(fs.readFileSync(scoresPath, "utf-8"));
        assert.equal(typeof scores.format.score, "number");
        assert.ok(scores.format.score >= 0 && scores.format.score <= 1);
        assert.equal(typeof scores.relevance.score, "number");
        assert.ok(scores.relevance.score >= 1 && scores.relevance.score <= 5);
        assert.equal(typeof scores.hallucination.score, "number");
        assert.ok(scores.hallucination.score >= 0 && scores.hallucination.score <= 1);
        assert.equal(typeof scores.extraction.score, "number");
        assert.ok(scores.extraction.score >= 0 && scores.extraction.score <= 1);
      }
    }
  });

  it("each eval pair directory includes raw-cv.md and usage.json", () => {
    const slugs = listTestJdSlugs();
    const models = parseEvalModels();
    for (const slug of slugs) {
      for (const model of models) {
        const dir = path.join(EVAL_RESULTS_DIR, slug, modelToDirSegment(model));
        assert.ok(fs.existsSync(path.join(dir, "raw-cv.md")), `${slug}/${model} missing raw-cv.md`);
        assert.ok(fs.existsSync(path.join(dir, "usage.json")), `${slug}/${model} missing usage.json`);
      }
    }
  });

  it("each JD has JD-level extraction.json from stage 1 pipeline", () => {
    const slugs = listTestJdSlugs();
    assert.ok(slugs.length >= 2);
    for (const slug of slugs) {
      const extractionPath = path.join(EVAL_RESULTS_DIR, slug, "extraction.json");
      assert.ok(
        fs.existsSync(extractionPath),
        `missing extraction.json for ${slug} at ${extractionPath}`
      );
      const payload = JSON.parse(fs.readFileSync(extractionPath, "utf-8"));
      assert.equal(typeof payload.extraction, "object");
      assert.ok(Array.isArray(payload.extraction.requirements));
      assert.equal(typeof payload.extractionScore.score, "number");
    }
  });

  it("composite scores are computable from four-dimension eval results", () => {
    const slugs = listTestJdSlugs();
    const models = parseEvalModels();
    assert.ok(slugs.length >= 1 && models.length >= 1);

    for (const slug of slugs) {
      for (const model of models) {
        const scoresPath = path.join(
          EVAL_RESULTS_DIR,
          slug,
          modelToDirSegment(model),
          "scores.json"
        );
        if (!fs.existsSync(scoresPath)) continue;
        const scores = JSON.parse(fs.readFileSync(scoresPath, "utf-8"));
        const composite = computeCompositeScore(scores);
        assert.ok(Number.isFinite(composite));
        assert.ok(composite >= 0 && composite <= 1);
      }
    }
  });
});

describe("TAILOR_MODEL default — .env.example and lib/env.ts consistency", () => {
  it(".env.example TAILOR_MODEL matches lib/env.ts DEFAULT_TAILOR_MODEL", () => {
    const fromExample = readTailorModelFromEnvExample();
    const fromEnvTs = readDefaultTailorModelFromEnvTs();
    assert.equal(fromExample, fromEnvTs);
  });

  it("DEFAULT_TAILOR_MODEL is a valid namespaced model string", () => {
    const model = readDefaultTailorModelFromEnvTs();
    assert.match(model, NAMESPACED_MODEL_RE);
  });

  it(".env.example TAILOR_MODEL includes eval rationale comment with date", () => {
    const content = fs.readFileSync(ENV_EXAMPLE_PATH, "utf-8");
    const tailorBlock = content.slice(content.indexOf("TAILOR_MODEL"));
    assert.match(
      tailorBlock.slice(0, 500),
      /(eval|evaluation|composite|winner|rationale)/i,
      "TAILOR_MODEL comment must document eval-based rationale"
    );
    assert.match(
      tailorBlock.slice(0, 500),
      /\d{4}-\d{2}-\d{2}/,
      "TAILOR_MODEL comment must include evaluation date"
    );
  });

  it("winning TAILOR_MODEL appears in eval-results for all JDs", () => {
    const winningModel = readDefaultTailorModelFromEnvTs();
    const slugs = listTestJdSlugs();
    assert.ok(slugs.length >= 2);
    for (const slug of slugs) {
      const scoresPath = path.join(
        EVAL_RESULTS_DIR,
        slug,
        modelToDirSegment(winningModel),
        "scores.json"
      );
      assert.ok(
        fs.existsSync(scoresPath),
        `winning model ${winningModel} must have eval results for ${slug}`
      );
    }
  });

  it(".env.example documents EVAL_EXTRACTION_MIN_SCORE with default 0.7", () => {
    const content = fs.readFileSync(ENV_EXAMPLE_PATH, "utf-8");
    assert.match(content, /^EVAL_EXTRACTION_MIN_SCORE=/m);
    assert.match(content, /0\.7/);
  });
});
