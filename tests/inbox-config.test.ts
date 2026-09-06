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
});
