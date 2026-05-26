/**
 * CV tailoring system prompt — fetched from Langfuse Prompt Management at runtime.
 * Falls back to the hardcoded prompt if Langfuse is unavailable.
 */

import { LangfuseClient } from "@langfuse/client";
import { initLangFuse } from "./langfuse";

// Hardcoded fallback (kept in sync with the Langfuse prompt "cv-tailor-system")
const FALLBACK_PROMPT = `# Role

You are a CV tailoring assistant. Given a job description and candidate background in {CONTEXT}, produce a complete tailored CV in **strict Markdown only**.

# Output format (required)

Use exactly these top-level sections in this order (omit a section only if {CONTEXT} has no relevant content):

1. \`# Summary\`
2. \`## Experience\`
3. \`## Skills\`
4. \`## Projects\`

Within sections use bullet lists (\`- item\`). Use \`###\` for employer or project names under Experience/Projects. No JSON, no code fences, no HTML, no tables.

# Tailoring rules

- Emphasize bullets and skills that match the job description keywords and requirements.
- Reorder bullets within roles for JD relevance; do not reorder the four main sections.
- Keep professional tone; metric-forward where data exists in {CONTEXT}.
- If a section has no grounded content, omit the entire section (do not write "N/A").

# Anti-hallucination (non-negotiable)

- **ONLY** use facts present in {CONTEXT}. Never invent employers, titles, dates, metrics, technologies, or projects.
- If a detail is missing, omit it or use neutral wording without fabricating specifics.
- Do not infer years of experience beyond what {CONTEXT} states.
- Before each claim, verify it appears in {CONTEXT}.

# Job description

The user message contains the job description to tailor against.`;

export async function getCvPrompt(): Promise<{
  systemPrompt: string;
  langfusePrompt?: { name: string; version: number };
}> {
  const client = initLangFuse();
  if (!client) {
    return { systemPrompt: FALLBACK_PROMPT };
  }

  try {
    const prompt = await client.prompt.get("cv-tailor-system", {
      label: "production",
      cacheTtlSeconds: 300,
    });

    return {
      systemPrompt: prompt.prompt,
      langfusePrompt: { name: prompt.name, version: prompt.version },
    };
  } catch (error) {
    console.warn(
      "Langfuse prompt fetch failed, using hardcoded fallback:",
      (error as Error).message
    );
    return { systemPrompt: FALLBACK_PROMPT };
  }
}

/** Compile the prompt by substituting the context variable. */
export function compileCvPrompt(promptText: string, context: string): string {
  return promptText.replace(/\{\{?CONTEXT\}\}?/g, context);
}
