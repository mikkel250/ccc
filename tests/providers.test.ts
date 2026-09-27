import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseNamespacedProvider } from "../lib/providers";

describe("parseNamespacedProvider", () => {
  it("accepts multi-segment openrouter model paths", () => {
    assert.equal(
      parseNamespacedProvider("openrouter/openai/gpt-5.4-mini"),
      "openrouter"
    );
    assert.equal(
      parseNamespacedProvider("openrouter/google/gemini-3.1-pro-preview"),
      "openrouter"
    );
  });

  it("rejects bare aliases and empty model strings", () => {
    assert.throws(() => parseNamespacedProvider("sonnet"), /Invalid model string/);
    assert.throws(() => parseNamespacedProvider(""), /Invalid model string/);
    assert.throws(() => parseNamespacedProvider("   "), /Invalid model string/);
  });

  it("rejects missing or dangling slashes", () => {
    assert.throws(() => parseNamespacedProvider("/anthropic/sonnet"), /Invalid model string/);
    assert.throws(() => parseNamespacedProvider("anthropic/"), /Invalid model string/);
    assert.throws(() => parseNamespacedProvider("anthropic//sonnet"), /Invalid model string/);
  });

  it("rejects path traversal and null-byte segments", () => {
    assert.throws(
      () => parseNamespacedProvider("anthropic/../etc"),
      /Invalid model string/
    );
    assert.throws(
      () => parseNamespacedProvider("anthropic/.\/sonnet"),
      /Invalid model string/
    );
    assert.throws(
      () => parseNamespacedProvider("anthropic/\0sonnet"),
      /Invalid model string/
    );
  });

  it("rejects backslash separators", () => {
    assert.throws(
      () => parseNamespacedProvider("anthropic/..\\..\\outside"),
      /Invalid model string/
    );
  });

  it("rejects unknown provider prefixes", () => {
    assert.throws(
      () => parseNamespacedProvider("cohere/command-r"),
      /Unknown provider/
    );
  });
});
