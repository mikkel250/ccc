import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertLocalMockClientUrls } from "../dev/local-service-urls.mjs";
import { getTailorModel } from "../lib/env";

const ports = { upstash: 8079, deepseek: 4010 };

function loopbackEnv(model?: string): Record<string, string> {
  const env: Record<string, string> = {
    UPSTASH_REDIS_REST_URL: "http://127.0.0.1:8079",
    DEEPSEEK_BASE_URL: "http://127.0.0.1:4010",
  };
  if (model !== undefined) env.TAILOR_MODEL = model;
  return env;
}

/** Same accept/reject decision as getTailorModel() for unset and empty TAILOR_MODEL. */
function assertFallbackMatchesGetTailorModel(model: string | undefined): void {
  const saved = process.env.TAILOR_MODEL;
  if (model === undefined) delete process.env.TAILOR_MODEL;
  else process.env.TAILOR_MODEL = model;
  try {
    const resolved = getTailorModel();
    const provider = resolved.slice(0, resolved.indexOf("/"));
    if (provider === "deepseek") {
      assert.doesNotThrow(() => assertLocalMockClientUrls(loopbackEnv(model), ports));
    } else {
      const shown = resolved.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      assert.throws(
        () => assertLocalMockClientUrls(loopbackEnv(model), ports),
        new RegExp(`TAILOR_MODEL[\\s\\S]*${shown}`)
      );
    }
  } finally {
    if (saved === undefined) delete process.env.TAILOR_MODEL;
    else process.env.TAILOR_MODEL = saved;
  }
}

describe("assertLocalMockClientUrls", () => {
  it("accepts loopback http(s) URLs on the mock ports", () => {
    assert.doesNotThrow(() =>
      assertLocalMockClientUrls(
        {
          UPSTASH_REDIS_REST_URL: "http://127.0.0.1:8079",
          DEEPSEEK_BASE_URL: "http://localhost:4010",
          TAILOR_MODEL: "deepseek/deepseek-chat",
        },
        ports
      )
    );
  });

  it("rejects a live host before any request is sent", () => {
    assert.throws(
      () =>
        assertLocalMockClientUrls(
          {
            UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
            DEEPSEEK_BASE_URL: "http://127.0.0.1:4010",
            TAILOR_MODEL: "deepseek/deepseek-chat",
          },
          ports
        ),
      /UPSTASH_REDIS_REST_URL/
    );
    assert.throws(
      () =>
        assertLocalMockClientUrls({
          UPSTASH_REDIS_REST_URL: "http://127.0.0.1:8079",
          DEEPSEEK_BASE_URL: "https://api.deepseek.com",
          TAILOR_MODEL: "deepseek/deepseek-chat",
        }),
      /DEEPSEEK_BASE_URL/
    );
  });

  it("rejects a loopback URL whose port is not the mock port", () => {
    assert.throws(
      () =>
        assertLocalMockClientUrls(
          {
            UPSTASH_REDIS_REST_URL: "http://127.0.0.1:6379",
            DEEPSEEK_BASE_URL: "http://127.0.0.1:4010",
            TAILOR_MODEL: "deepseek/deepseek-chat",
          },
          ports
        ),
      /8079/
    );
  });

  it("rejects a TAILOR_MODEL that would not stay on the DeepSeek mock", () => {
    assert.throws(
      () => assertLocalMockClientUrls(loopbackEnv("anthropic/sonnet"), ports),
      /TAILOR_MODEL/
    );
    assert.throws(
      () =>
        assertLocalMockClientUrls(
          loopbackEnv("openrouter/deepseek/deepseek-v4-pro"),
          ports
        ),
      /TAILOR_MODEL/
    );
    assert.doesNotThrow(() =>
      assertLocalMockClientUrls(loopbackEnv("deepseek/deepseek-chat"), ports)
    );
    assertFallbackMatchesGetTailorModel(undefined);
    assertFallbackMatchesGetTailorModel("");
  });
});
