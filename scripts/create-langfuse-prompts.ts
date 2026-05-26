/**
 * Upload CV tailoring prompt to Langfuse Prompt Management.
 *
 * Usage: npx tsx scripts/create-langfuse-prompts.ts
 * Requires LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL in env.
 */

import "dotenv/config";
import { LangfuseClient } from "@langfuse/client";

const CV_PROMPT_TEXT = `# Role

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

// Convert single {CONTEXT} to double {{CONTEXT}} for Langfuse variable syntax
const LANGFUSE_PROMPT_TEXT = CV_PROMPT_TEXT.replace(/\{CONTEXT\}/g, "{{CONTEXT}}");

async function main() {
  const required = ["LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`Missing env vars: ${missing.join(", ")}`);
    process.exit(1);
  }

  const langfuse = new LangfuseClient({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com",
  });

  console.log("Creating prompt: cv-tailor-system");

  const prompt = await langfuse.prompt.create({
    name: "cv-tailor-system",
    type: "text",
    prompt: LANGFUSE_PROMPT_TEXT,
    labels: ["production"],
    config: {
      description: "System prompt for CV tailoring. Variable: {{CONTEXT}} = full knowledge base content.",
    },
  });

  console.log(`Created: ${prompt.name} v${prompt.version}`);
  console.log(`Labels: ${prompt.labels.join(", ")}`);
  console.log("Done.");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
