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

  it("rejects leading and trailing empty segments", () => {
    assert.throws(() => parseNamespacedProvider("anthropic/"), /Invalid model string/);
    assert.throws(() => parseNamespacedProvider("/sonnet"), /Invalid model string/);
    assert.throws(
      () => parseNamespacedProvider("/anthropic/sonnet"),
      /Invalid model string/
    );
  });

  it("rejects interior empty, dot, and double-dot segments", () => {
    assert.throws(
      () => parseNamespacedProvider("anthropic//sonnet"),
      /Invalid model string/
    );
    assert.throws(
      () => parseNamespacedProvider("openrouter//openai/gpt"),
      /Invalid model string/
    );
    assert.throws(
      () => parseNamespacedProvider("anthropic/../etc"),
      /Invalid model string/
    );
    assert.throws(
      () => parseNamespacedProvider("anthropic/sonnet/.."),
      /Invalid model string/
    );
    assert.throws(
      () => parseNamespacedProvider("openrouter/./gpt"),
      /Invalid model string/
    );
    assert.throws(
      () => parseNamespacedProvider("anthropic/./sonnet"),
      /Invalid model string/
    );
  });

  it("rejects backslash and null-byte separators", () => {
    assert.throws(
      () => parseNamespacedProvider("anthropic/..\\outside"),
      /Invalid model string/
    );
    assert.throws(
      () => parseNamespacedProvider("anthropic/..\\..\\outside"),
      /Invalid model string/
    );
    assert.throws(
      () => parseNamespacedProvider("anthropic/sonnet\u0000"),
      /Invalid model string/
    );
    assert.throws(
      () => parseNamespacedProvider("anthropic/sonnet\u0000extra"),
      /Invalid model string/
    );
  });
});
