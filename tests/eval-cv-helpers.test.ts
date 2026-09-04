import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { parseEvalModels } from "../app/api/lib/eval-cv-helpers";

describe("parseEvalModels — retired judge map", () => {
  const originalMapJson = process.env.EVAL_JUDGE_MAP_JSON;
  const originalEvalModels = process.env.EVAL_MODELS;

  afterEach(() => {
    if (originalMapJson === undefined) delete process.env.EVAL_JUDGE_MAP_JSON;
    else process.env.EVAL_JUDGE_MAP_JSON = originalMapJson;
    if (originalEvalModels === undefined) delete process.env.EVAL_MODELS;
    else process.env.EVAL_MODELS = originalEvalModels;
  });

  it("does not consult EVAL_JUDGE_MAP_JSON when listing generation models", () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: unknown) => warnings.push(String(msg));
    try {
      delete process.env.EVAL_MODELS;
      process.env.EVAL_JUDGE_MAP_JSON = "{not-json";
      const models = parseEvalModels();
      assert.ok(models.length > 0);
      assert.ok(
        !warnings.some((w) => /EVAL_JUDGE_MAP_JSON|JUDGE_MAP/i.test(w)),
        `parseEvalModels must not read retired judge-map env; got warnings: ${warnings.join(" | ")}`
      );
    } finally {
      console.warn = originalWarn;
    }
  });
});
