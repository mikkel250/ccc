import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  getInboxRedisTimeoutMs,
  getInboxScanBackoffMs,
} from "../app/api/lib/inbox-config";

describe("inbox-config timeouts", () => {
  const keys = ["INBOX_REDIS_TIMEOUT_MS", "INBOX_SCAN_BACKOFF_MS"] as const;
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of keys) {
      const previous = saved[key];
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
      delete saved[key];
    }
  });

  it("reads INBOX_REDIS_TIMEOUT_MS from env with a positive default", () => {
    for (const key of keys) saved[key] = process.env[key];
    delete process.env.INBOX_REDIS_TIMEOUT_MS;
    assert.equal(getInboxRedisTimeoutMs(), 2000);
    process.env.INBOX_REDIS_TIMEOUT_MS = "1500";
    assert.equal(getInboxRedisTimeoutMs(), 1500);
  });

  it("still reads scan backoff from env", () => {
    for (const key of keys) saved[key] = process.env[key];
    process.env.INBOX_SCAN_BACKOFF_MS = "0";
    assert.equal(getInboxScanBackoffMs(), 0);
  });
});
