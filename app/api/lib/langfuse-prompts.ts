/**
 * Langfuse Prompt Management client.
 *
 * Fetches prompts from Langfuse at runtime with a local hardcoded fallback.
 * This enables deployment-free prompt iteration via the Langfuse UI when
 * credentials are configured, and zero-dependency operation otherwise.
 *
 * Prompt Naming Convention: lowercase, hyphenated
 *   - portfolio-chat-system    → Chat system prompt (type: text)
 *   - portfolio-jd-analysis    → JD analysis prompt (type: text)
 */

import { LangfuseClient } from '@langfuse/client';
import { CHAT_SYSTEM_PROMPT } from './chat-prompt';
import { JD_ANALYSIS_SYSTEM_PROMPT } from './jd-prompt';

// ---------------------------------------------------------------------------
// Init (lazy singleton — reused across requests within a warm function)
// ---------------------------------------------------------------------------
let _client: LangfuseClient | null = null;

function getClient(): LangfuseClient | null {
  if (_client) return _client;
  if (
    process.env.LANGFUSE_PUBLIC_KEY &&
    process.env.LANGFUSE_SECRET_KEY
  ) {
    _client = new LangfuseClient({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
    });
  }
  return _client;
}

// ---------------------------------------------------------------------------
// Prompt descriptors (single source of truth for names + local fallbacks)
// ---------------------------------------------------------------------------

type PromptEntry = { local: string; type: 'text'; description: string };

const PROMPT_REGISTRY = {
  'portfolio-chat-system': {
    local: CHAT_SYSTEM_PROMPT,
    type: 'text' as const,
    description: 'Chat system prompt for the AI recruiting assistant',
  },
  'portfolio-jd-analysis': {
    local: JD_ANALYSIS_SYSTEM_PROMPT,
    type: 'text' as const,
    description: 'Job description analysis prompt',
  },
};

type PromptName = keyof typeof PROMPT_REGISTRY;

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Return a prompt descriptor that carries both the raw template and a
 * `.compile()` method for variable interpolation. Falls back to the
 * hardcoded local version when Langfuse is unreachable or not configured.
 */
export async function getPrompt(name: PromptName) {
  const entry: PromptEntry = PROMPT_REGISTRY[name];
  const client = getClient();

  // Try Langfuse first (when available)
  if (client) {
    try {
      const lfPrompt = await client.prompt.get(name, {
        type: entry.type,
        label: 'production',
      });
      return {
        name,
        compile: (vars: Record<string, string>) => lfPrompt.compile(vars),
        __langfusePrompt: lfPrompt,
      };
    } catch (err) {
      console.warn(`[langfuse-prompts] Failed to fetch "${name}", using local fallback:`, err);
    }
  }

  // Fallback: use the hardcoded template with simple {{var}} replacement
  return {
    name,
    compile: (vars: Record<string, string>) => {
      let tpl = entry.local;
      for (const [key, value] of Object.entries(vars)) {
        tpl = tpl.split(`{{${key}}}`).join(value);
      }
      return tpl;
    },
    __langfusePrompt: null,
  };
}

/**
 * Shorthand that compiles immediately for simple call-sites.
 */
export async function compilePrompt(
  name: PromptName,
  vars: Record<string, string>
): Promise<string> {
  const p = await getPrompt(name);
  return p.compile(vars);
}

/**
 * Expose the registry for migration/verification scripts.
 */
export { PROMPT_REGISTRY };
