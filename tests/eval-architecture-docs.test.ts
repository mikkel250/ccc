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
});
