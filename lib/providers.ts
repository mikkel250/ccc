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
