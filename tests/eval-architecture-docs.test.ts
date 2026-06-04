import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ARCHITECTURE_PATH = path.join(process.cwd(), "docs", "arch", "ARCHITECTURE.md");
const MODEL_SELECTION_PATH = path.join(process.cwd(), "docs", "arch", "MODEL_SELECTION.md");
const ENV_EXAMPLE_PATH = path.join(process.cwd(), ".env.example");

function readTailorModelFromEnvExample(): string {
  const content = fs.readFileSync(ENV_EXAMPLE_PATH, "utf-8");
  const match = content.match(/^TAILOR_MODEL=(.+)$/m);
  return match?.[1]?.trim() ?? "";
}

describe("docs/arch/ARCHITECTURE.md — eval pipeline documentation", () => {
  it("exists and documents the Evaluation pipeline subsection", () => {
    assert.ok(fs.existsSync(ARCHITECTURE_PATH), "docs/arch/ARCHITECTURE.md must exist");
    const content = fs.readFileSync(ARCHITECTURE_PATH, "utf-8");
    assert.match(content, /###\s+Evaluation pipeline/i);
    assert.match(content, /eval-cv\.ts/i);
    assert.match(content, /eval-results/i);
    assert.match(content, /Langfuse/i);
  });

  it("documents two-stage judging: stage 1 extraction gate then stage 2 scoring", () => {
    const content = fs.readFileSync(ARCHITECTURE_PATH, "utf-8");
    assert.match(content, /stage\s*1|Stage 1/i);
    assert.match(content, /stage\s*2|Stage 2/i);
    assert.match(content, /(JD extraction|extract.*metadata|extraction judge)/i);
    assert.match(content, /(format compliance|relevance|hallucination)/i);
  });

  it("documents extraction cache strategy and EVAL_EXTRACTION_MIN_SCORE threshold", () => {
    const content = fs.readFileSync(ARCHITECTURE_PATH, "utf-8");
    assert.match(content, /(extraction cache|cached per JD|cache)/i);
    assert.match(content, /EVAL_EXTRACTION_MIN_SCORE|extraction.*threshold|minimum extraction score/i);
  });

  it("documents extraction.json JD-level artifact and four scoring dimensions", () => {
    const content = fs.readFileSync(ARCHITECTURE_PATH, "utf-8");
    assert.match(content, /extraction\.json/i);
    assert.match(content, /format compliance/i);
    assert.match(content, /(accomplishment relevance|relevance)/i);
    assert.match(content, /hallucination/i);
    assert.match(content, /extraction/i);
  });

  it("contains no stale single-pass or single-stage judging references", () => {
    const content = fs.readFileSync(ARCHITECTURE_PATH, "utf-8");
    assert.ok(!/single-pass/i.test(content), "must not reference single-pass judging");
    assert.ok(!/single-stage/i.test(content), "must not reference single-stage judging");
    const evalSection = content.slice(
      content.indexOf("### Evaluation pipeline"),
      content.indexOf("### Key decisions")
    );
    assert.ok(
      !/three dimensions/i.test(evalSection) || /four dimensions/i.test(evalSection),
      "evaluation pipeline must document four dimensions, not three only"
    );
  });

  it("marks LLM-as-Judge eval pipeline as complete in MVP scope, not Deferred or In Progress", () => {
    const content = fs.readFileSync(ARCHITECTURE_PATH, "utf-8");
    const evalMentions = content.match(/LLM-as-Judge[^\n]*/gi) ?? [];
    assert.ok(evalMentions.length > 0, "must mention LLM-as-Judge eval pipeline");
    for (const line of evalMentions) {
      assert.ok(!/Deferred/i.test(line), `must not defer eval pipeline: ${line}`);
      assert.ok(!/In Progress/i.test(line), `must not leave eval in progress: ${line}`);
    }
    assert.match(content, /(complete|MVP\)|implemented)/i);
  });
});

describe("docs/arch/MODEL_SELECTION.md — eval results and TAILOR_MODEL default", () => {
  it("marks LLM-as-Judge evaluation pipeline as Complete", () => {
    const content = fs.readFileSync(MODEL_SELECTION_PATH, "utf-8");
    assert.match(content, /LLM-as-Judge evaluation pipeline/i);
    assert.match(content, /Complete/i);
    assert.ok(!/In Progress/i.test(content), "MODEL_SELECTION must not say In Progress for eval");
  });

  it("documents JD extraction quality as a gating dimension in eval pipeline", () => {
    const content = fs.readFileSync(MODEL_SELECTION_PATH, "utf-8");
    assert.match(content, /(extraction|JD extraction|extraction judge|extraction quality)/i);
    assert.match(content, /(gate|threshold|EVAL_EXTRACTION_MIN_SCORE)/i);
  });

  it("includes eval results summary with composite scores per model", () => {
    const content = fs.readFileSync(MODEL_SELECTION_PATH, "utf-8");
    assert.match(content, /(composite|eval results|evaluation results)/i);
    assert.match(content, /deepseek\/deepseek-v4-pro/);
    assert.match(content, /anthropic\/sonnet/);
  });

  it("documents final TAILOR_MODEL default with rationale matching .env.example", () => {
    const content = fs.readFileSync(MODEL_SELECTION_PATH, "utf-8");
    const tailorModel = readTailorModelFromEnvExample();
    assert.ok(tailorModel.length > 0, "TAILOR_MODEL must be set in .env.example");
    assert.ok(
      content.includes(tailorModel),
      `MODEL_SELECTION.md must document final TAILOR_MODEL default (${tailorModel})`
    );
    assert.match(content, /(rationale|won|selected|default)/i);
  });
});
