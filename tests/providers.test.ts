import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseNamespacedProvider } from "../lib/providers";

describe("parseNamespacedProvider", () => {
  it("accepts multi-segment OpenRouter model ids", () => {
    assert.equal(
      parseNamespacedProvider("openrouter/openai/gpt-5.4-mini"),
      "openrouter"
    );
  });

  it("rejects bare aliases without a provider prefix", () => {
    assert.throws(() => parseNamespacedProvider("sonnet"), /Invalid model string/);
    assert.throws(() => parseNamespacedProvider("gpt-4o"), /Invalid model string/);
  });

  it("rejects unknown provider prefixes", () => {
    assert.throws(
      () => parseNamespacedProvider("cohere/command-r"),
      /Unknown provider "cohere"/
    );
  });

  it("rejects path-traversal and empty segments", () => {
    assert.throws(
      () => parseNamespacedProvider("anthropic/../etc"),
      /Invalid model string/
    );
    assert.throws(
      () => parseNamespacedProvider("anthropic/sonnet/.."),
      /Invalid model string/
    );
    assert.throws(
      () => parseNamespacedProvider("anthropic/"),
      /Invalid model string/
    );
    assert.throws(
      () => parseNamespacedProvider("/anthropic/sonnet"),
      /Invalid model string/
    );
  });

  it("rejects backslash and null-byte separators", () => {
    assert.throws(
      () => parseNamespacedProvider("anthropic/..\\..\\outside"),
      /Invalid model string/
    );
    assert.throws(
      () => parseNamespacedProvider("anthropic/sonnet\u0000extra"),
      /Invalid model string/
    );
  });
});
