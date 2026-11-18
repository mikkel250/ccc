import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("next.config.mjs (Next.js 16)", () => {
  it("does not define a webpack function so default Turbopack can build", () => {
    const content = readFileSync(join(root, "next.config.mjs"), "utf8");
    assert.doesNotMatch(
      content,
      /\bwebpack\s*:/,
      "Next 16 `next build` fails when a custom webpack config is present; migrate Edge ignores instead of keeping webpack"
    );
  });

  it("keeps OTEL packages off the bundler graph", () => {
    const content = readFileSync(join(root, "next.config.mjs"), "utf8");
    assert.match(content, /serverExternalPackages/);
    assert.match(content, /@opentelemetry\/sdk-node/);
    assert.match(content, /@langfuse\/otel/);
  });
});
