import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  getInboxClaimTtlSeconds,
  getInboxMessageIdMaxChars,
  getInboxProcessedTtlSeconds,
  getInboxRedisPrefix,
  getInboxRedisTimeoutMs,
} from "../app/api/lib/inbox-config";

const KEYS = [
  "INBOX_REDIS_PREFIX",
  "INBOX_CLAIM_TTL_SECONDS",
  "INBOX_PROCESSED_TTL_SECONDS",
  "INBOX_MESSAGE_ID_MAX_CHARS",
  "INBOX_REDIS_TIMEOUT_MS",
] as const;

describe("inbox-config", () => {
  const saved = new Map<string, string | undefined>();

  afterEach(() => {
    for (const key of KEYS) {
      const previous = saved.get(key);
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
    saved.clear();
  });

  function capture(key: (typeof KEYS)[number]): void {
    if (!saved.has(key)) saved.set(key, process.env[key]);
  }

  it("uses documented defaults when env is unset", () => {
    for (const key of KEYS) {
      capture(key);
      delete process.env[key];
    }
    assert.equal(getInboxRedisPrefix(), "inbox");
    assert.equal(getInboxClaimTtlSeconds(), 900);
    assert.equal(getInboxProcessedTtlSeconds(), 0);
    assert.equal(getInboxMessageIdMaxChars(), 128);
    assert.equal(getInboxRedisTimeoutMs(), 2000);
  });

  it("reads environment overrides", () => {
    for (const key of KEYS) capture(key);
    process.env.INBOX_REDIS_PREFIX = "ccc-inbox";
    process.env.INBOX_CLAIM_TTL_SECONDS = "60";
    process.env.INBOX_PROCESSED_TTL_SECONDS = "86400";
    process.env.INBOX_MESSAGE_ID_MAX_CHARS = "64";
    process.env.INBOX_REDIS_TIMEOUT_MS = "1500";
    assert.equal(getInboxRedisPrefix(), "ccc-inbox");
    assert.equal(getInboxClaimTtlSeconds(), 60);
    assert.equal(getInboxProcessedTtlSeconds(), 86400);
    assert.equal(getInboxMessageIdMaxChars(), 64);
    assert.equal(getInboxRedisTimeoutMs(), 1500);
  });

  it("clamps invalid zero and negative bounds", () => {
    for (const key of KEYS) capture(key);
    process.env.INBOX_CLAIM_TTL_SECONDS = "0";
    process.env.INBOX_PROCESSED_TTL_SECONDS = "-5";
    process.env.INBOX_MESSAGE_ID_MAX_CHARS = "0";
    process.env.INBOX_REDIS_TIMEOUT_MS = "-1";
    assert.equal(getInboxClaimTtlSeconds(), 1);
    assert.equal(getInboxProcessedTtlSeconds(), 0);
    assert.equal(getInboxMessageIdMaxChars(), 1);
    assert.equal(getInboxRedisTimeoutMs(), 1);
  });
});
