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
  const expiresAt = new Map<string, number>();
  function purge(key: string): void {
    const exp = expiresAt.get(key);
    if (exp !== undefined && exp <= Date.now()) {
      store.delete(key);
      expiresAt.delete(key);
    }
  }
  return {
    store,
    get: async (key) => {
      purge(key);
      return store.get(key) ?? null;
    },
    set: async (key, value, opts) => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      purge(key);
      if (opts?.nx && store.has(key)) {
        return null;
      }
      store.set(key, value);
      if (opts?.ex !== undefined) {
        expiresAt.set(key, Date.now() + opts.ex * 1000);
      } else {
        expiresAt.delete(key);
      }
      return "OK";
    },
    deleteIfValue: async (key, value) => {
      purge(key);
      if (store.get(key) !== value) {
        return false;
      }
      store.delete(key);
      expiresAt.delete(key);
      return true;
    },
    expireIfOwned: async (key, value, ttlSeconds) => {
      purge(key);
      if (store.get(key) !== value) {
        return false;
      }
      expiresAt.set(key, Date.now() + ttlSeconds * 1000);
      return true;
    },
    markProcessedIfOwned: async (claimKey, processedKey, token, ttlSeconds) => {
      purge(claimKey);
      purge(processedKey);
      const current = store.get(claimKey);
      if (current !== token) {
        return false;
      }
      store.set(processedKey, "1");
      if (ttlSeconds > 0) {
        expiresAt.set(processedKey, Date.now() + ttlSeconds * 1000);
      } else {
        expiresAt.delete(processedKey);
      }
      store.delete(claimKey);
      expiresAt.delete(claimKey);
      return true;
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
    const claimed = await claimInboxMessage(ID);
    assert.equal(claimed.ok, true);
    if (!claimed.ok || claimed.outcome !== "won") {
      throw new Error("expected a won claim");
    }
    const marked = await markInboxProcessed(ID, claimed.token);
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
        assert.equal(typeof first.claimToken, "string");
        assert.equal(memory.store.get(inboxClaimKey(ID)), first.claimToken);
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

  it("returns processed when a mark lands before the claim SET commits", async () => {
    const origSet = memory.set.bind(memory);
    memory.set = async (key, value, opts) => {
      if (key === inboxClaimKey(ID)) {
        await origSet(inboxProcessedKey(ID), "1");
      }
      return origSet(key, value, opts);
    };
    const result = await claimInboxMessage(ID);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.outcome, "processed");
    }
    assert.equal(memory.store.has(inboxClaimKey(ID)), false);
    assert.equal(memory.store.has(inboxProcessedKey(ID)), true);
  });

  it("treats a timed-out SET that still committed as a won claim", async () => {
    const origSet = memory.set.bind(memory);
    let firstClaimSet = true;
    memory.set = async (key, value, opts) => {
      const result = await origSet(key, value, opts);
      if (firstClaimSet && key === inboxClaimKey(ID)) {
        firstClaimSet = false;
        throw new Error("Inbox Redis timed out");
      }
      return result;
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

  it("returns lost when ownership changes during the processed recheck", async () => {
    const origGet = memory.get.bind(memory);
    memory.get = async (key) => {
      if (
        key === inboxProcessedKey(ID) &&
        memory.store.has(inboxClaimKey(ID))
      ) {
        memory.store.set(inboxClaimKey(ID), "replacement-token");
      }
      return origGet(key);
    };

    const result = await claimInboxMessage(ID);

    assert.deepEqual(result, { ok: true, outcome: "lost" });
    assert.equal(memory.store.get(inboxClaimKey(ID)), "replacement-token");
  });

  it("does not delete a replacement claim when a processed mark wins", async () => {
    const origGet = memory.get.bind(memory);
    memory.get = async (key) => {
      if (
        key === inboxProcessedKey(ID) &&
        memory.store.has(inboxClaimKey(ID))
      ) {
        memory.store.set(inboxClaimKey(ID), "replacement-token");
        memory.store.set(inboxProcessedKey(ID), "1");
      }
      return origGet(key);
    };

    const result = await claimInboxMessage(ID);

    assert.deepEqual(result, { ok: true, outcome: "processed" });
    assert.equal(memory.store.get(inboxClaimKey(ID)), "replacement-token");
  });

  it("returns a Redis error instead of throwing when processed GET times out", async () => {
    const origGet = memory.get.bind(memory);
    memory.get = async (key) => {
      if (key === inboxProcessedKey(ID)) {
        throw new Error("Inbox Redis timed out");
      }
      return origGet(key);
    };
    const result = await claimInboxMessage(ID);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "Inbox Redis timed out");
    }
  });

  it("returns a Redis error when claim verification GET times out", async () => {
    const origGet = memory.get.bind(memory);
    memory.get = async (key) => {
      if (key === inboxClaimKey(ID) && memory.store.has(key)) {
        throw new Error("Inbox Redis timed out");
      }
      return origGet(key);
    };
    const result = await claimInboxMessage(ID);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "Inbox Redis timed out");
    }
  });

  it("releases the claim when body extraction fails", async () => {
    const result = await extractUnprocessedInboxMessage(ID, { payload: {} });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /no usable text/);
    }
    assert.equal(memory.store.has(inboxClaimKey(ID)), false);
    assert.equal(memory.store.has(inboxProcessedKey(ID)), false);
  });

  it("marks processed only while the claim token still owns the key", async () => {
    const claimed = await claimInboxMessage(ID);
    assert.equal(claimed.ok, true);
    if (!claimed.ok || claimed.outcome !== "won") {
      throw new Error("expected a won claim");
    }
    const stolen = await markInboxProcessed(ID, "other-worker-token");
    assert.equal(stolen.ok, false);
    if (!stolen.ok) {
      assert.match(stolen.error, /claim/i);
    }
    assert.equal(memory.store.has(inboxProcessedKey(ID)), false);
    assert.equal(memory.store.get(inboxClaimKey(ID)), claimed.token);

    const marked = await markInboxProcessed(ID, claimed.token);
    assert.equal(marked.ok, true);
    assert.equal(memory.store.has(inboxProcessedKey(ID)), true);
    assert.equal(memory.store.has(inboxClaimKey(ID)), false);
  });

  it("does not mark processed after the claim expires", async () => {
    const claimed = await claimInboxMessage(ID);
    assert.equal(claimed.ok, true);
    if (!claimed.ok || claimed.outcome !== "won") {
      throw new Error("expected a won claim");
    }
    memory.store.delete(inboxClaimKey(ID));
    const marked = await markInboxProcessed(ID, claimed.token);
    assert.equal(marked.ok, false);
    if (!marked.ok) {
      assert.match(marked.error, /claim/i);
    }
    assert.equal(memory.store.has(inboxProcessedKey(ID)), false);
    assert.equal(memory.store.has(inboxClaimKey(ID)), false);
  });
});
