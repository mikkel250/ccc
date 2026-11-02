import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertLocalMockClientUrls } from "../dev/local-service-urls.mjs";

const ports = { upstash: 8079, deepseek: 4010 };

describe("assertLocalMockClientUrls", () => {
  it("accepts loopback http(s) URLs on the mock ports", () => {
    assert.doesNotThrow(() =>
      assertLocalMockClientUrls(
        {
          UPSTASH_REDIS_REST_URL: "http://127.0.0.1:8079",
          DEEPSEEK_BASE_URL: "http://localhost:4010",
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
          },
          ports
        ),
      /8079/
    );
  });
});
