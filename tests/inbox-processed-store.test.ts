import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  __injectInboxKvForTest,
  applyInboxClaimTransition,
  claimInboxMessage,
  extractUnprocessedInboxMessage,
  inboxClaimKey,
  inboxProcessedKey,
  markInboxProcessed,
  parseInboxMessageId,
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
    set: async (key, value) => {
      store.set(key, value);
      return "OK";
    },
    claimIfUnprocessed: async (processedKey, claimKey, token) => {
      const next = applyInboxClaimTransition(
        {
          processed: store.has(processedKey),
          claim: store.get(claimKey) ?? null,
        },
        token
      );
      if (next.claim == null) {
        store.delete(claimKey);
      } else {
        store.set(claimKey, next.claim);
      }
      return next.outcome;
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

describe("applyInboxClaimTransition", () => {
  const token = "own-token";

  it("wins an empty claim and keeps a matching token", () => {
    assert.deepEqual(
      applyInboxClaimTransition({ processed: false, claim: null }, token),
      { outcome: "won", claim: token }
    );
    assert.deepEqual(
      applyInboxClaimTransition({ processed: false, claim: token }, token),
      { outcome: "won", claim: token }
    );
  });

  it("loses when another token owns the claim", () => {
    assert.deepEqual(
      applyInboxClaimTransition(
        { processed: false, claim: "other-token" },
        token
      ),
      { outcome: "lost", claim: "other-token" }
    );
  });

  it("deletes only our leftover claim when processed", () => {
    assert.deepEqual(
      applyInboxClaimTransition({ processed: true, claim: token }, token),
      { outcome: "processed", claim: null }
    );
    assert.deepEqual(
      applyInboxClaimTransition(
        { processed: true, claim: "replacement-token" },
        token
      ),
      { outcome: "processed", claim: "replacement-token" }
    );
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

  it("returns processed without writing a claim when the mark already exists", async () => {
    await markInboxProcessed(ID);
    const result = await claimInboxMessage(ID);
    assert.deepEqual(result, { ok: true, outcome: "processed" });
    assert.equal(memory.store.has(inboxClaimKey(ID)), false);
    assert.equal(memory.store.has(inboxProcessedKey(ID)), true);
  });

  it("treats a timed-out claim that still committed as a won claim", async () => {
    const orig = memory.claimIfUnprocessed.bind(memory);
    let first = true;
    memory.claimIfUnprocessed = async (...args) => {
      const outcome = await orig(...args);
      if (first) {
        first = false;
        throw new Error("Inbox Redis timed out");
      }
      return outcome;
    };
    const result = await claimInboxMessage(ID);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.outcome, "won");
    }
    const claimValue = memory.store.get(inboxClaimKey(ID));
    assert.equal(typeof claimValue, "string");
    assert.notEqual(claimValue, "1");
  });

  it("does not delete a replacement claim when a processed mark wins", async () => {
    const orig = memory.claimIfUnprocessed.bind(memory);
    let first = true;
    memory.claimIfUnprocessed = async (...args) => {
      const outcome = await orig(...args);
      if (first) {
        first = false;
        memory.store.set(inboxClaimKey(ID), "replacement-token");
        memory.store.set(inboxProcessedKey(ID), "1");
        throw new Error("Inbox Redis timed out");
      }
      return orig(...args);
    };

    const result = await claimInboxMessage(ID);

    assert.deepEqual(result, { ok: true, outcome: "processed" });
    assert.equal(memory.store.get(inboxClaimKey(ID)), "replacement-token");
  });

  it("deletes our leftover claim when processed wins after a timed-out commit", async () => {
    const orig = memory.claimIfUnprocessed.bind(memory);
    let first = true;
    memory.claimIfUnprocessed = async (...args) => {
      const outcome = await orig(...args);
      if (first) {
        first = false;
        memory.store.set(inboxProcessedKey(ID), "1");
        throw new Error("Inbox Redis timed out");
      }
      return orig(...args);
    };

    const result = await claimInboxMessage(ID);

    assert.deepEqual(result, { ok: true, outcome: "processed" });
    assert.equal(memory.store.has(inboxClaimKey(ID)), false);
  });
});
