import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getEnvBoolean } from "../lib/env";
import { getRedisClient, resetRedisClientForTest } from "../app/api/lib/redis";
import {
  __injectInboxKvForTest,
  claimInboxMessage,
  INBOX_CLAIM_LOST_ERROR,
  inboxClaimKey,
  inboxProcessedKey,
  markInboxProcessed,
} from "../app/api/lib/inbox-processed-store";

type InboxRedisLiveGate =
  | { action: "skip" }
  | { action: "fail"; error: string }
  | { action: "run" };

function resolveInboxRedisLiveGate(
  runInboxRedisTests: boolean,
  url: string | undefined,
  token: string | undefined
): InboxRedisLiveGate {
  if (!runInboxRedisTests) {
    return { action: "skip" };
  }
  const missing: string[] = [];
  if (!url) missing.push("UPSTASH_REDIS_REST_URL");
  if (!token) missing.push("UPSTASH_REDIS_REST_TOKEN");
  if (missing.length > 0) {
    return {
      action: "fail",
      error: `missing Redis credentials: ${missing.join(", ")}`,
    };
  }
  return { action: "run" };
}

const inboxRedisLiveGate = resolveInboxRedisLiveGate(
  getEnvBoolean("RUN_INBOX_REDIS_TESTS", false),
  process.env.UPSTASH_REDIS_REST_URL,
  process.env.UPSTASH_REDIS_REST_TOKEN
);

describe("inbox Redis live credential gate", () => {
  it("fails an opted-in run when a Redis credential is missing and skips when the flag is off", () => {
    assert.deepEqual(resolveInboxRedisLiveGate(false, undefined, undefined), {
      action: "skip",
    });
    assert.deepEqual(
      resolveInboxRedisLiveGate(false, "https://example.upstash.io", "token"),
      { action: "skip" }
    );
    assert.deepEqual(
      resolveInboxRedisLiveGate(true, "https://example.upstash.io", "token"),
      { action: "run" }
    );
    assert.deepEqual(resolveInboxRedisLiveGate(true, undefined, "token"), {
      action: "fail",
      error: "missing Redis credentials: UPSTASH_REDIS_REST_URL",
    });
    assert.deepEqual(resolveInboxRedisLiveGate(true, "https://example.upstash.io", undefined), {
      action: "fail",
      error: "missing Redis credentials: UPSTASH_REDIS_REST_TOKEN",
    });
    assert.deepEqual(resolveInboxRedisLiveGate(true, undefined, undefined), {
      action: "fail",
      error: "missing Redis credentials: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN",
    });
  });
});

describe("inbox Redis claim integration", { concurrency: 1 }, () => {
  before(() => {
    if (inboxRedisLiveGate.action === "fail") {
      throw new Error(inboxRedisLiveGate.error);
    }
  });

  async function withLivePrefix(
    run: (messageId: string) => Promise<void>
  ): Promise<void> {
    const previousPrefix = process.env.INBOX_REDIS_PREFIX;
    const previousProcessedTtl = process.env.INBOX_PROCESSED_TTL_SECONDS;
    const prefix = `inbox-it-${randomUUID().replace(/-/g, "")}`;
    const messageId = `msg-${randomUUID().replace(/-/g, "")}`;
    process.env.INBOX_REDIS_PREFIX = prefix;
    // Live keys must expire if cleanup is interrupted (default processed TTL is 0).
    process.env.INBOX_PROCESSED_TTL_SECONDS = "60";
    __injectInboxKvForTest(null);
    try {
      await run(messageId);
    } finally {
      try {
        await getRedisClient()
          .del(inboxClaimKey(messageId), inboxProcessedKey(messageId))
          .catch(() => undefined);
      } catch {
        // Missing Upstash config must not mask the test assertion error.
      }
      __injectInboxKvForTest(null);
      resetRedisClientForTest();
      if (previousPrefix === undefined) delete process.env.INBOX_REDIS_PREFIX;
      else process.env.INBOX_REDIS_PREFIX = previousPrefix;
      if (previousProcessedTtl === undefined) {
        delete process.env.INBOX_PROCESSED_TTL_SECONDS;
      } else {
        process.env.INBOX_PROCESSED_TTL_SECONDS = previousProcessedTtl;
      }
    }
  }

  it("lets only one concurrent Redis claim win", { skip: inboxRedisLiveGate.action === "skip" }, async () => {
    await withLivePrefix(async (messageId) => {
      const [a, b] = await Promise.all([
        claimInboxMessage(messageId),
        claimInboxMessage(messageId),
      ]);
      assert.equal(a.ok && b.ok, true);
      if (a.ok && b.ok) {
        const outcomes = [a.outcome, b.outcome].sort();
        assert.deepEqual(outcomes, ["lost", "won"]);
      }
      assert.equal(Boolean(await getRedisClient().exists(inboxClaimKey(messageId))), true);
      assert.equal(
        Boolean(await getRedisClient().exists(inboxProcessedKey(messageId))),
        false
      );
    });
  });

  it(
    "returns processed on Redis when the marker already exists",
    { skip: inboxRedisLiveGate.action === "skip" },
    async () => {
      await withLivePrefix(async (messageId) => {
        const seeded = await claimInboxMessage(messageId);
        assert.equal(seeded.ok, true);
        if (!seeded.ok || seeded.outcome !== "won") {
          throw new Error("expected to win the seed claim");
        }
        const stolen = await markInboxProcessed(messageId, "other-worker-token");
        assert.equal(stolen.ok, false);
        if (!stolen.ok) {
          assert.equal(stolen.error, INBOX_CLAIM_LOST_ERROR);
        }
        assert.equal(
          Boolean(await getRedisClient().exists(inboxProcessedKey(messageId))),
          false
        );
        assert.equal(await getRedisClient().get(inboxClaimKey(messageId)), seeded.token);
        const marked = await markInboxProcessed(messageId, seeded.token);
        assert.equal(marked.ok, true);
        const [a, b] = await Promise.all([
          claimInboxMessage(messageId),
          claimInboxMessage(messageId),
        ]);
        assert.equal(a.ok && b.ok, true);
        if (a.ok && b.ok) {
          assert.equal(a.outcome, "processed");
          assert.equal(b.outcome, "processed");
        }
        assert.equal(Boolean(await getRedisClient().exists(inboxClaimKey(messageId))), false);
        assert.equal(
          Boolean(await getRedisClient().exists(inboxProcessedKey(messageId))),
          true
        );
      });
    }
  );
});
