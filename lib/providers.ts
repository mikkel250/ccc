/**
 * Provider registry — leaf module with no imports of its own.
 *
 * Both `llm.ts` (integration dispatch) and `env.ts` (model-string validation)
 * need the known-provider set. A static import of `llm.ts` from `env.ts` would
 * create a circular dependency (llm -> env -> llm), so the registry lives here
 * instead, where both modules can import it statically with no cycle.
 */
export type Provider = 'openai' | 'anthropic' | 'google' | 'openrouter' | 'deepseek';

export const KNOWN_PROVIDERS = new Set<Provider>([
  'openai',
  'anthropic',
  'google',
  'openrouter',
  'deepseek',
]);

/**
 * Shared namespaced-model parse used by routing (`detectProvider`) and
 * smoke parity path nesting. Rejects bare aliases, unknown providers,
 * empty/`.`/`..` segments, and backslash path separators.
 */
export function parseNamespacedProvider(model: string): Provider {
  if (model.includes("\\") || model.includes("\0")) {
    throw new Error(
      `Invalid model string "${model}": must be namespaced as provider/model`
    );
  }
  const segments = model.split("/");
  if (
    segments.length < 2 ||
    segments[0] === "" ||
    segments[segments.length - 1] === ""
  ) {
    throw new Error(
      `Invalid model string "${model}": must be namespaced as provider/model`
    );
  }
  const providerSegment = segments[0]!;
  if (!KNOWN_PROVIDERS.has(providerSegment as Provider)) {
    throw new Error(
      `Unknown provider "${providerSegment}" in model "${model}"`
    );
  }
  if (segments.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(
      `Invalid model string "${model}": must be namespaced as provider/model`
    );
  }
  return providerSegment as Provider;
}
