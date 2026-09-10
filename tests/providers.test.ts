import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseNamespacedProvider } from "../lib/providers";

describe("parseNamespacedProvider", () => {
  it("returns the provider segment for valid namespaced models", () => {
    assert.equal(parseNamespacedProvider("anthropic/sonnet"), "anthropic");
    assert.equal(
      parseNamespacedProvider("openrouter/openai/gpt-5.4-mini"),
      "openrouter"
    );
  });

  it("rejects null bytes and backslash path separators", () => {
    assert.throws(
      () => parseNamespacedProvider("anthropic/sonnet\u0000"),
      /Invalid model string/
    );
    assert.throws(
      () => parseNamespacedProvider("anthropic/..\\outside"),
      /Invalid model string/
    );
  });

  it("rejects empty, dot, and double-dot path segments", () => {
    assert.throws(() => parseNamespacedProvider("anthropic/"), /Invalid model/);
    assert.throws(() => parseNamespacedProvider("/sonnet"), /Invalid model/);
    assert.throws(
      () => parseNamespacedProvider("anthropic/../etc"),
      /Invalid model/
    );
    assert.throws(
      () => parseNamespacedProvider("anthropic/./sonnet"),
      /Invalid model/
    );
  });

  it("rejects bare aliases and unknown providers", () => {
    assert.throws(() => parseNamespacedProvider("sonnet"), /Invalid model/);
    assert.throws(
      () => parseNamespacedProvider("cohere/command-r"),
      /Unknown provider/
    );
  });
});
