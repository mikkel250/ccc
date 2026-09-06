import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  __injectInboxKvForTest,
  claimInboxMessage,
  extractUnprocessedInboxMessage,
  inboxClaimKey,
  inboxProcessedKey,
  markInboxProcessed,
  parseInboxMessageId,
  releaseInboxClaim,
  type InboxKv,
} from "../app/api/lib/inbox-processed-store";

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function plainMessage(text: string): unknown {
  return {
    payload: {
      mimeType: "text/plain",
      body: { data: b64(text) },
    },
  };
}

function createMemoryKv(): InboxKv & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key) => store.get(key) ?? null,
    set: async (key, value, opts) => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (opts?.nx && store.has(key)) {
        return null;
      }
      store.set(key, value);
      return "OK";
    },
    del: async (key) => {
      store.delete(key);
    },
  };
}

const ID = "msg123abc";

describe("parseInboxMessageId", () => {
  it("rejects empty, whitespace, and delimiter characters", () => {
    assert.equal(parseInboxMessageId("").ok, false);
    assert.equal(parseInboxMessageId("a:b").ok, false);
    assert.equal(parseInboxMessageId("a b").ok, false);
  });

  it("accepts a Gmail-shaped id", () => {
    const result = parseInboxMessageId(ID);
    assert.equal(result.ok, true);
  });
});

describe("inbox processed store", () => {
  let memory: ReturnType<typeof createMemoryKv>;

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    memory = createMemoryKv();
    __injectInboxKvForTest(memory);
  });

  afterEach(() => {
    __injectInboxKvForTest(null);
  });

  it("lets only one concurrent claim win", async () => {
    const [a, b] = await Promise.all([
      claimInboxMessage(ID),
      claimInboxMessage(ID),
    ]);
    assert.equal(a.ok && b.ok, true);
    if (a.ok && b.ok) {
      const outcomes = [a.outcome, b.outcome].sort();
      assert.deepEqual(outcomes, ["lost", "won"]);
    }
    assert.equal(memory.store.has(inboxClaimKey(ID)), true);
    assert.equal(memory.store.has(inboxProcessedKey(ID)), false);
  });

  it("skips extract after the processed mark", async () => {
    const marked = await markInboxProcessed(ID);
    assert.equal(marked.ok, true);
    const result = await extractUnprocessedInboxMessage(ID, plainMessage("JD"));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.status, "skipped-processed");
    }
  });

  it("extracts after a claim that never became processed (crash recovery)", async () => {
    const first = await extractUnprocessedInboxMessage(
      ID,
      plainMessage("Need a GM")
    );
    assert.equal(first.ok, true);
    if (first.ok) {
      assert.equal(first.status, "extracted");
      if (first.status === "extracted") {
        assert.equal(first.jobDescription, "Need a GM");
      }
    }
    assert.equal(memory.store.has(inboxProcessedKey(ID)), false);
    memory.store.delete(inboxClaimKey(ID));
    const recovered = await extractUnprocessedInboxMessage(
      ID,
      plainMessage("Need a GM")
    );
    assert.equal(recovered.ok, true);
    if (recovered.ok) {
      assert.equal(recovered.status, "extracted");
    }
  });

  it("does not write Redis for an invalid messageId", async () => {
    const result = await extractUnprocessedInboxMessage("bad:id", plainMessage("JD"));
    assert.equal(result.ok, false);
    assert.equal(memory.store.size, 0);
  });

  it("releaseInboxClaim deletes the NX claim key", async () => {
    const claimed = await claimInboxMessage(ID);
    assert.equal(claimed.ok, true);
    assert.equal(memory.store.has(inboxClaimKey(ID)), true);
    const released = await releaseInboxClaim(ID);
    assert.equal(released.ok, true);
    assert.equal(memory.store.has(inboxClaimKey(ID)), false);
  });
});
