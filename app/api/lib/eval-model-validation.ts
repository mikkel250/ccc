/**
 * Runtime validation for eval CV-generation model strings.
 * OpenRouter IDs synced against https://openrouter.ai/api/v1/models (2026-06-10).
 */

import anthropicModels from "../../../config/anthropic-models.json";

/** OpenRouter model IDs confirmed available (vendor/model, no openrouter/ prefix). */
export const CONFIRMED_OPENROUTER_MODEL_IDS = new Set([
  "deepseek/deepseek-v4-pro",
  "deepseek/deepseek-v4-flash",
  "qwen/qwen3.7-max",
  "xiaomi/mimo-v2.5-pro",
  "minimax/minimax-m3",
  "google/gemini-3.1-pro-preview",
  "openai/gpt-5.4",
  "openai/gpt-5.5",
  "openai/gpt-5.4-mini",
]);

const ANTHROPIC_ALIASES = new Set(Object.keys(anthropicModels));
const ANTHROPIC_PINNED_IDS = new Set(Object.values(anthropicModels));

function isNamespacedModelString(value: string): boolean {
  return /^[^/\s]+\/.+/.test(value);
}

/** Map a namespaced model string to its OpenRouter model ID, if routable via OpenRouter. */
export function toOpenRouterModelId(model: string): string | null {
  const slash = model.indexOf("/");
  if (slash <= 0) return null;
  const gateway = model.slice(0, slash);
  if (gateway === "openrouter") {
    return model.slice(slash + 1);
  }
  if (gateway === "deepseek") {
    return model;
  }
  return null;
}

function isValidAnthropicModel(model: string): boolean {
  const cleaned = model.slice("anthropic/".length);
  if (ANTHROPIC_ALIASES.has(cleaned)) return true;
  if (ANTHROPIC_PINNED_IDS.has(cleaned)) return true;
  return false;
}

/**
 * Fail fast when a CV-generation model is unknown or not in the confirmed catalog.
 * Anthropic models must use aliases from config/anthropic-models.json (e.g. anthropic/opus).
 */
export function validateGenerationModel(model: string): void {
  if (!isNamespacedModelString(model)) {
    throw new Error(
      `Invalid eval generation model "${model}": must be namespaced as provider/model`
    );
  }

  const provider = model.slice(0, model.indexOf("/"));

  if (provider === "openrouter" || provider === "deepseek") {
    const orId = toOpenRouterModelId(model);
    if (!orId || !CONFIRMED_OPENROUTER_MODEL_IDS.has(orId)) {
      throw new Error(
        `Invalid eval generation model "${model}": OpenRouter ID "${orId ?? model}" is not in the confirmed catalog — check https://openrouter.ai/models or override via EVAL_MODELS`
      );
    }
    return;
  }

  if (provider === "anthropic") {
    if (!isValidAnthropicModel(model)) {
      throw new Error(
        `Invalid eval generation model "${model}": use an Anthropic alias (${[...ANTHROPIC_ALIASES].join(", ")}) or a pinned model ID from config/anthropic-models.json`
      );
    }
    return;
  }

  throw new Error(
    `Invalid eval generation model "${model}": provider "${provider}" is not supported for CV generation`
  );
}

export function validateGenerationModels(models: readonly string[]): void {
  for (const model of models) {
    validateGenerationModel(model);
  }
}
