import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const MODEL_SELECTION_PATH = path.join(process.cwd(), "docs", "arch", "MODEL_SELECTION.md");
const ENV_EXAMPLE_PATH = path.join(process.cwd(), ".env.example");

function readTailorModelFromEnvExample(): string {
  const content = fs.readFileSync(ENV_EXAMPLE_PATH, "utf-8");
  const match = content.match(/^TAILOR_MODEL=(.+)$/m);
  return match?.[1]?.trim() ?? "";
}

describe("docs/arch/MODEL_SELECTION.md — cross-file contracts", () => {
  it("documents final TAILOR_MODEL default matching .env.example", () => {
    assert.ok(fs.existsSync(MODEL_SELECTION_PATH), "docs/arch/MODEL_SELECTION.md must exist");
    const content = fs.readFileSync(MODEL_SELECTION_PATH, "utf-8");
    const tailorModel = readTailorModelFromEnvExample();
    assert.ok(tailorModel.length > 0, "TAILOR_MODEL must be set in .env.example");
    assert.ok(
      content.includes(tailorModel),
      `MODEL_SELECTION.md must document the TAILOR_MODEL default (${tailorModel}) to match .env.example`
    );
  });

  it("documents chat() default matching lib/env.ts DEFAULT_LLM_MODEL", () => {
    const envTs = fs.readFileSync(
      path.join(process.cwd(), "lib", "env.ts"),
      "utf-8"
    );
    const match = envTs.match(
      /const DEFAULT_LLM_MODEL\s*=\s*['"]([^'"]+)['"]/
    );
    assert.ok(match, "DEFAULT_LLM_MODEL must be defined in lib/env.ts");
    const defaultModel = match[1]!;
    const content = fs.readFileSync(MODEL_SELECTION_PATH, "utf-8");
    assert.ok(
      content.includes(`Default \`chat()\` model: \`${defaultModel}\``),
      `MODEL_SELECTION.md must document chat() default as ${defaultModel}`
    );
  });
});
