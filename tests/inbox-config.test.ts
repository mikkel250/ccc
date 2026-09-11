import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getInboxRedisTimeoutMs } from "../app/api/lib/inbox-config";

describe("inbox-config timeouts", () => {
  const key = "INBOX_REDIS_TIMEOUT_MS";
  let saved: string | undefined;

  afterEach(() => {
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  });

  it("reads INBOX_REDIS_TIMEOUT_MS from env with a positive default", () => {
    saved = process.env[key];
    delete process.env[key];
    assert.equal(getInboxRedisTimeoutMs(), 2000);
    process.env[key] = "1500";
    assert.equal(getInboxRedisTimeoutMs(), 1500);
  });

  it("clamps non-positive values to 1ms and falls back on non-numeric input", () => {
    saved = process.env[key];
    process.env[key] = "0";
    assert.equal(getInboxRedisTimeoutMs(), 1);
    process.env[key] = "-20";
    assert.equal(getInboxRedisTimeoutMs(), 1);
    process.env[key] = "not-a-number";
    assert.equal(getInboxRedisTimeoutMs(), 2000);
  });
});
