#!/usr/bin/env npx tsx
/**
 * RETIRED — markdown CV generation eval path removed after JSON curator cutover (KTD9).
 *
 * Use the live-API smoke instead:
 *   npm run smoke -- [baseUrl] [jdPath]
 *
 * Artifact helper re-exports remain for seed/eval-results checks.
 */

export {
  DEFAULT_EVAL_MODELS,
  parseEvalModels,
  buildEvalArtifactDir,
  buildScoresPayload,
  buildUsagePayload,
  type EvalScoresPayload,
  type EvalUsagePayload,
} from "../app/api/lib/eval-cv-helpers";

const isDirectRun =
  typeof process.argv[1] === "string" &&
  /eval-cv\.ts$/.test(process.argv[1].replace(/\\/g, "/"));

if (isDirectRun) {
  console.error(
    [
      "scripts/eval-cv.ts markdown generation eval is retired.",
      "Use: npm run smoke -- [baseUrl] [jdPath]",
      "See docs/test/TESTING.md (smoke vs unit tests).",
    ].join("\n")
  );
  process.exit(1);
}
