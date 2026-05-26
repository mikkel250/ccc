// devpro-build/app/api/lib/prompts.ts

/**
 * Shared prompt utilities and helper functions
 * Note: Main chat prompt is in chat-prompt.ts, JD prompt is in jd-prompt.ts
 */

import { compilePrompt } from './langfuse-prompts';
import { CHAT_SYSTEM_PROMPT } from './chat-prompt';

/**
 * Check if query is asking about professional vs personal experience
 * Helps determine response strategy in knowledge base retrieval
 */
export function isProfessionalExperienceQuery(query: string): boolean {
  const professionalKeywords = /professional\s+(experience|work|background)|on\s+the\s+job|at\s+work|in\s+production/i;
  return professionalKeywords.test(query);
}

/**
 * Detect if query is about skills/technologies
 */
export function isSkillQuery(query: string): boolean {
  const skillKeywords = /do\s+you\s+(know|have\s+experience|use)|familiar\s+with|experience\s+with|skills?\s+in/i;
  return skillKeywords.test(query);
}

/**
 * Detect if query contains AI-related keywords
 */
export function isAIQuery(query: string): boolean {
  const aiKeywords = /\b(AI|LLM|GPT|machine learning|agentic|agent|autonomous|prompt engineering|AutoGPT|LangChain)\b/i;
  return aiKeywords.test(query);
}

/**
 * Build chat system prompt with injected context and placeholders.
 *
 * Tries Langfuse Prompt Management first (deployment-free iteration),
 * falls back to the local hardcoded prompt.
 */
export async function buildChatSystemPrompt(
  context: string,
  options?: {
    calendlyLink?: string;
  }
): Promise<string> {
  const calendlyLink = options?.calendlyLink || process.env.NEXT_PUBLIC_CALENDLY_LINK || '';

  const prompt = await compilePrompt('portfolio-chat-system', {
    context,
    calendly_link: calendlyLink,
  });

  // If compilePrompt fell back to local, replace the legacy {VAR} syntax
  if (!process.env.LANGFUSE_PUBLIC_KEY) {
    let legacy = prompt;
    legacy = legacy.replace('{CONTEXT}', context);
    legacy = legacy.split('{CALENDLY_LINK}').join(calendlyLink);
    return legacy;
  }

  return prompt;
}