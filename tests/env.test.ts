import { createRequire } from "node:module";
import path from "node:path";
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Module } from "node:module";
import {
  getDeepSeekBaseUrl,
  getEnvString,
  getEvalExtractionModel,
  getEvalJudgeModel,
  getEvalModels,
  getLLMConfig,
  getTailorModel,
  resetProviderRegistryCache,
} from "../lib/env";
import {
  CANDIDATE_GENERATION_MODELS,
  DEFAULT_EVAL_EXTRACTION_MODEL,
  DEFAULT_EVAL_JUDGE_MODEL,
  DEFAULT_EVAL_MODELS_CSV,
  getJudgeMap,
  resetJudgeMapCache,
} from "../app/api/lib/eval-schema";

describe("getEnvString", () => {
  const key = "TEST_ENV_STRING_KEY";

  afterEach(() => {
    delete process.env[key];
  });

  it("returns default when env var is unset", () => {
    delete process.env[key];
    assert.equal(getEnvString(key, "fallback"), "fallback");
  });

  it("returns default when env var is empty string", () => {
    process.env[key] = "";
    assert.equal(getEnvString(key, "fallback"), "fallback");
  });

  it("returns default when env var is whitespace only", () => {
    process.env[key] = "   ";
    assert.equal(getEnvString(key, "fallback"), "fallback");
  });

  it("returns env value when non-empty", () => {
    process.env[key] = "custom-value";
    assert.equal(getEnvString(key, "fallback"), "custom-value");
  });
});

describe("getTailorModel", () => {
  const originalTailorModel = process.env.TAILOR_MODEL;
  const originalAiModel = process.env.AI_MODEL;

  afterEach(() => {
    if (originalTailorModel === undefined) delete process.env.TAILOR_MODEL;
    else process.env.TAILOR_MODEL = originalTailorModel;
    if (originalAiModel === undefined) delete process.env.AI_MODEL;
    else process.env.AI_MODEL = originalAiModel;
  });

  it("prefers TAILOR_MODEL when set", () => {
    process.env.TAILOR_MODEL = "openrouter/google/gemini-2.5-pro";
    process.env.AI_MODEL = "deepseek/deepseek-v4-pro";
    assert.equal(getTailorModel(), "openrouter/google/gemini-2.5-pro");
  });

  it("uses DEFAULT_TAILOR_MODEL when TAILOR_MODEL is unset, ignoring AI_MODEL", () => {
    delete process.env.TAILOR_MODEL;
    process.env.AI_MODEL = "deepseek/deepseek-v4-pro";
    assert.equal(getTailorModel(), "anthropic/sonnet");
  });

  it("uses default when neither env var is set", () => {
    delete process.env.TAILOR_MODEL;
    delete process.env.AI_MODEL;
    assert.equal(getTailorModel(), "anthropic/sonnet");
  });

  it("returns valid namespaced TAILOR_MODEL when set", () => {
    process.env.TAILOR_MODEL = "openrouter/google/gemini-2.5-pro";
    assert.equal(getTailorModel(), "openrouter/google/gemini-2.5-pro");
  });

  it('throws when TAILOR_MODEL is unnamespaced "sonnet"', () => {
    process.env.TAILOR_MODEL = "sonnet";
    assert.throws(() => getTailorModel(), /namespaced|provider\/model/i);
  });

  it('throws when TAILOR_MODEL has unknown provider "fake/gpt"', () => {
    process.env.TAILOR_MODEL = "fake/gpt";
    assert.throws(() => getTailorModel(), /unknown provider|fake/i);
  });

  it("passes validation for default when env vars are unset", () => {
    delete process.env.TAILOR_MODEL;
    delete process.env.AI_MODEL;
    assert.doesNotThrow(() => getTailorModel());
  });
});

describe("getEvalJudgeModel", () => {
  const originalJudgeModel = process.env.EVAL_JUDGE_MODEL;

  afterEach(() => {
    if (originalJudgeModel === undefined) delete process.env.EVAL_JUDGE_MODEL;
    else process.env.EVAL_JUDGE_MODEL = originalJudgeModel;
  });

  it("prefers EVAL_JUDGE_MODEL when set", () => {
    process.env.EVAL_JUDGE_MODEL = "deepseek/deepseek-v4-pro";
    assert.equal(getEvalJudgeModel(), "deepseek/deepseek-v4-pro");
  });

  it("uses default when EVAL_JUDGE_MODEL is unset", () => {
    delete process.env.EVAL_JUDGE_MODEL;
    assert.equal(getEvalJudgeModel(), DEFAULT_EVAL_JUDGE_MODEL);
  });

  it("uses default when EVAL_JUDGE_MODEL is empty string", () => {
    process.env.EVAL_JUDGE_MODEL = "";
    assert.equal(getEvalJudgeModel(), DEFAULT_EVAL_JUDGE_MODEL);
  });

  it("returns valid namespaced EVAL_JUDGE_MODEL when set", () => {
    process.env.EVAL_JUDGE_MODEL = "deepseek/deepseek-v4-pro";
    assert.equal(getEvalJudgeModel(), "deepseek/deepseek-v4-pro");
  });

  it('throws when EVAL_JUDGE_MODEL is unnamespaced "claude"', () => {
    process.env.EVAL_JUDGE_MODEL = "claude";
    assert.throws(() => getEvalJudgeModel(), /namespaced|provider\/model/i);
  });

  it('throws when EVAL_JUDGE_MODEL has unknown provider "fake/gpt"', () => {
    process.env.EVAL_JUDGE_MODEL = "fake/gpt";
    assert.throws(() => getEvalJudgeModel(), /unknown provider|fake/i);
  });

  it("passes validation for default when env var is unset", () => {
    delete process.env.EVAL_JUDGE_MODEL;
    assert.doesNotThrow(() => getEvalJudgeModel());
  });
});

describe("getEvalModels", () => {
  const original = process.env.EVAL_MODELS;

  afterEach(() => {
    if (original === undefined) delete process.env.EVAL_MODELS;
    else process.env.EVAL_MODELS = original;
  });

  it("defaults to DEFAULT_EVAL_MODELS_CSV from eval-schema when unset", () => {
    delete process.env.EVAL_MODELS;
    assert.equal(getEvalModels(), DEFAULT_EVAL_MODELS_CSV);
    assert.deepEqual(
      getEvalModels().split(","),
      [...CANDIDATE_GENERATION_MODELS]
    );
  });

  it("defaults when EVAL_MODELS is empty string", () => {
    process.env.EVAL_MODELS = "";
    assert.equal(getEvalModels(), DEFAULT_EVAL_MODELS_CSV);
  });
});

describe("getEvalExtractionModel", () => {
  const original = process.env.EVAL_EXTRACTION_MODEL;

  afterEach(() => {
    if (original === undefined) delete process.env.EVAL_EXTRACTION_MODEL;
    else process.env.EVAL_EXTRACTION_MODEL = original;
  });

  it("defaults when EVAL_EXTRACTION_MODEL is empty string", () => {
    process.env.EVAL_EXTRACTION_MODEL = "";
    assert.equal(getEvalExtractionModel(), DEFAULT_EVAL_EXTRACTION_MODEL);
  });

  it("returns valid namespaced EVAL_EXTRACTION_MODEL when set", () => {
    process.env.EVAL_EXTRACTION_MODEL = "openrouter/openai/gpt-4o-mini";
    assert.equal(getEvalExtractionModel(), "openrouter/openai/gpt-4o-mini");
  });

  it('throws when EVAL_EXTRACTION_MODEL is unnamespaced "gpt-4o-mini"', () => {
    process.env.EVAL_EXTRACTION_MODEL = "gpt-4o-mini";
    assert.throws(() => getEvalExtractionModel(), /namespaced|provider\/model/i);
  });

  it('throws when EVAL_EXTRACTION_MODEL has unknown provider "fake/gpt"', () => {
    process.env.EVAL_EXTRACTION_MODEL = "fake/gpt";
    assert.throws(() => getEvalExtractionModel(), /unknown provider|fake/i);
  });

  it("passes validation for default when env var is unset", () => {
    delete process.env.EVAL_EXTRACTION_MODEL;
    assert.doesNotThrow(() => getEvalExtractionModel());
  });
});

describe("getJudgeMap — lazy init after env change", () => {
  const originalMapJson = process.env.EVAL_JUDGE_MAP_JSON;

  afterEach(() => {
    if (originalMapJson === undefined) delete process.env.EVAL_JUDGE_MAP_JSON;
    else process.env.EVAL_JUDGE_MAP_JSON = originalMapJson;
    resetJudgeMapCache();
  });

  it("reflects EVAL_JUDGE_MAP_JSON set after module load", () => {
    delete process.env.EVAL_JUDGE_MAP_JSON;
    resetJudgeMapCache();
    const before = getJudgeMap()["anthropic/sonnet"];

    process.env.EVAL_JUDGE_MAP_JSON = JSON.stringify({
      "anthropic/sonnet": "openrouter/openai/gpt-5.4-mini",
    });
    resetJudgeMapCache();
    const after = getJudgeMap()["anthropic/sonnet"];

    assert.notEqual(after, before);
    assert.equal(after, "openrouter/openai/gpt-5.4-mini");
  });
});

const envRequire = createRequire(path.join(process.cwd(), "lib/env.ts"));
const llmModuleId = envRequire.resolve("../app/api/lib/llm");

function stubLlmKnownProviders(value: unknown): void {
  envRequire.cache[llmModuleId] = {
    id: llmModuleId,
    filename: llmModuleId,
    loaded: true,
    exports: { KNOWN_PROVIDERS: value },
  } as Module;
}

describe("getProviderRegistry — llm import cycle", () => {
  it("loads llm module without throwing when getLLMConfig validates defaults", async () => {
    const { LLM_CONFIG } = await import("../app/api/lib/llm");
    assert.equal(typeof LLM_CONFIG.defaultModel, "string");
    assert.match(LLM_CONFIG.defaultModel, /^[^/]+\/.+/);
  });

  it("getLLMConfig returns a validated default model after llm import", async () => {
    await import("../app/api/lib/llm");
    const config = getLLMConfig();
    assert.equal(typeof config.defaultModel, "string");
    assert.match(config.defaultModel, /^[^/]+\/.+/);
  });
});

describe("getProviderRegistry — invalid KNOWN_PROVIDERS fallback", () => {
  const originalLlmModule = envRequire.cache[llmModuleId];
  const originalTailorModel = process.env.TAILOR_MODEL;

  afterEach(() => {
    resetProviderRegistryCache();
    if (originalLlmModule) {
      envRequire.cache[llmModuleId] = originalLlmModule;
    } else {
      delete envRequire.cache[llmModuleId];
    }
    if (originalTailorModel === undefined) delete process.env.TAILOR_MODEL;
    else process.env.TAILOR_MODEL = originalTailorModel;
  });

  it("uses env-derived fallback when KNOWN_PROVIDERS is undefined (partial llm load)", () => {
    stubLlmKnownProviders(undefined);
    resetProviderRegistryCache();
    assert.doesNotThrow(() => getTailorModel());
    assert.equal(getTailorModel(), "anthropic/sonnet");
  });

  it("uses env-derived fallback when KNOWN_PROVIDERS is not a Set", () => {
    stubLlmKnownProviders({ openai: true });
    resetProviderRegistryCache();
    assert.doesNotThrow(() => getTailorModel());
    assert.equal(getTailorModel(), "anthropic/sonnet");
  });

  it("accepts providers present in configured models when llm registry is invalid", () => {
    stubLlmKnownProviders(undefined);
    resetProviderRegistryCache();
    process.env.TAILOR_MODEL = "openrouter/google/gemini-2.5-pro";
    assert.equal(getTailorModel(), "openrouter/google/gemini-2.5-pro");
  });

  it("rejects providers missing from a sanitized but incomplete llm registry", () => {
    stubLlmKnownProviders(new Set(["openai"]));
    resetProviderRegistryCache();
    delete process.env.TAILOR_MODEL;
    assert.throws(() => getTailorModel(), /unknown provider|anthropic/i);
  });
});

describe("getDeepSeekBaseUrl", () => {
  const original = process.env.DEEPSEEK_BASE_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.DEEPSEEK_BASE_URL;
    else process.env.DEEPSEEK_BASE_URL = original;
  });

  it("defaults when DEEPSEEK_BASE_URL is empty string", () => {
    process.env.DEEPSEEK_BASE_URL = "";
    assert.equal(getDeepSeekBaseUrl(), "https://api.deepseek.com");
  });
});
