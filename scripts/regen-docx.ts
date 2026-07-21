/**
 * Local regen: curated JSON → .docx with no LLM (KTD10 / AE2 / AE2b).
 *
 * Usage:
 *   npx tsx scripts/regen-docx.ts <input.json> <output.docx> [--builder-version=1.0.0]
 *
 * When --builder-version is provided, exits non-zero if it does not match BUILDER_VERSION
 * and does not write the output file.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  BUILDER_VERSION,
  buildJsonDocx,
} from "../app/api/lib/json-docx-builder";
import { validateCvJson } from "../app/api/lib/cv-schema";

function usage(): never {
  console.error(
    "Usage: npx tsx scripts/regen-docx.ts <input.json> <output.docx> [--builder-version=<version>]"
  );
  process.exit(1);
}

function parseArgs(argv: string[]): {
  inputPath: string;
  outputPath: string;
  expectVersion: string | null;
} {
  const positional: string[] = [];
  let expectVersion: string | null = null;

  for (const arg of argv) {
    if (arg.startsWith("--builder-version=")) {
      expectVersion = arg.slice("--builder-version=".length);
      continue;
    }
    if (arg === "--builder-version") {
      console.error("--builder-version requires =value");
      usage();
    }
    if (arg.startsWith("-")) {
      console.error(`Unknown flag: ${arg}`);
      usage();
    }
    positional.push(arg);
  }

  if (positional.length !== 2) usage();
  return {
    inputPath: resolve(positional[0]),
    outputPath: resolve(positional[1]),
    expectVersion,
  };
}

async function main(): Promise<void> {
  const { inputPath, outputPath, expectVersion } = parseArgs(process.argv.slice(2));

  if (expectVersion !== null && expectVersion !== BUILDER_VERSION) {
    console.error(
      `Builder version mismatch: expected ${expectVersion}, current ${BUILDER_VERSION}`
    );
    process.exit(1);
  }

  if (!existsSync(inputPath)) {
    console.error(`Input not found: ${inputPath}`);
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(inputPath, "utf8"));
  } catch {
    console.error(`Failed to parse JSON: ${inputPath}`);
    process.exit(1);
  }

  const validated = validateCvJson(parsed);
  if (!validated.ok) {
    console.error(validated.error);
    process.exit(1);
  }

  const built = await buildJsonDocx(validated.data);
  if (!built.ok) {
    console.error(built.error);
    process.exit(1);
  }

  writeFileSync(outputPath, built.buffer);
  console.log(`Wrote ${outputPath} (builder ${built.builderVersion})`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
