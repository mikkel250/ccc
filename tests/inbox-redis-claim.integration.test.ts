import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getRedisClient, resetRedisClientForTest } from "../app/api/lib/redis";
import {
  __injectInboxKvForTest,
  claimInboxMessage,
  inboxClaimKey,
  inboxProcessedKey,
  markInboxProcessed,
} from "../app/api/lib/inbox-processed-store";

const runLive = process.env.RUN_INBOX_REDIS_TESTS === "true";

describe("inbox Redis claim integration", { concurrency: 1 }, () => {
  async function withLivePrefix(
    run: (messageId: string) => Promise<void>
  ): Promise<void> {
    const previous = process.env.INBOX_REDIS_PREFIX;
    const prefix = `inbox-it-${randomUUID().replace(/-/g, "")}`;
    const messageId = `msg-${randomUUID().replace(/-/g, "")}`;
    process.env.INBOX_REDIS_PREFIX = prefix;
    __injectInboxKvForTest(null);
    try {
      await run(messageId);
    } finally {
      await getRedisClient()
        .del(inboxClaimKey(messageId), inboxProcessedKey(messageId))
        .catch(() => undefined);
      __injectInboxKvForTest(null);
      resetRedisClientForTest();
      if (previous === undefined) delete process.env.INBOX_REDIS_PREFIX;
      else process.env.INBOX_REDIS_PREFIX = previous;
    }
  }

  it("lets only one concurrent Redis claim win", { skip: !runLive }, async () => {
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
    { skip: !runLive },
    async () => {
      await withLivePrefix(async (messageId) => {
        const seeded = await claimInboxMessage(messageId);
        assert.equal(seeded.ok, true);
        if (!seeded.ok || seeded.outcome !== "won") {
          throw new Error("expected to win the seed claim");
        }
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
