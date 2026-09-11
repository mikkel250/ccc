/**
 * Publish the JSON curator prompt to Langfuse as `cv-curator-json` (label: production).
 *
 * Usage: npx tsx scripts/create-langfuse-prompts.ts
 * Requires LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL in env.
 *
 * Run this in the same release as a curator-contract change. A live production
 * prompt that still emits bare CV JSON is served in preference to the fallback.
 */
import "dotenv/config";
import { LangfuseClient } from "@langfuse/client";
import {
  CURATOR_LANGFUSE_PROMPT_NAME,
  getCuratorPromptFallbackText,
} from "../app/api/lib/curator-prompt";

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

  const promptText = getCuratorPromptFallbackText();
  console.log(`Creating prompt: ${CURATOR_LANGFUSE_PROMPT_NAME}`);

  const prompt = await langfuse.prompt.create({
    name: CURATOR_LANGFUSE_PROMPT_NAME,
    type: "text",
    prompt: promptText,
    labels: ["production"],
    config: {
      description:
        "JSON curator system prompt. Variables: {{CURATION_MODE_POLICY}}, {{MASTER_CV_JSON}}. Strict output: { curated_cv, reply_text }.",
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
