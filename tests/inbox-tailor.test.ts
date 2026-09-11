import { describe, it, mock, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tailorCvDeps } from "../app/api/lib/tailor-cv-deps";
import {
  __injectInboxKvForTest,
  claimInboxMessage,
  inboxClaimKey,
  inboxProcessedKey,
  markInboxProcessed,
  type InboxKv,
} from "../app/api/lib/inbox-processed-store";
import { tailorLabeledMessage } from "../app/api/lib/inbox-tailor";
import { BUILDER_VERSION } from "../app/api/lib/json-docx-builder";
import {
  DEFAULT_STRICT_REPLY,
  strictCuratorJson,
} from "../tests/helpers/strict-curator";
import { ensureEnv } from "../tests/helpers/tailor-request";

const FIXTURE_CURATED = JSON.parse(
  readFileSync(
    join(process.cwd(), "tests/fixtures/curated-cv-valid.json"),
    "utf8"
  )
) as Record<string, unknown>;

const ID = "msg123abc";
const JD = "We need a general manager with P&L ownership.";

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
    markProcessedIfOwned: async (claimKey, processedKey, token) => {
      purge(claimKey);
      purge(processedKey);
      const current = store.get(claimKey);
      if (current !== undefined && current !== token) {
        return false;
      }
      store.set(processedKey, "1");
      expiresAt.delete(processedKey);
      if (current === token) {
        store.delete(claimKey);
        expiresAt.delete(claimKey);
      }
      return true;
    },
  };
}

function mockPipelineSuccess(): void {
  mock.method(tailorCvDeps, "requireMasterCv", () => FIXTURE_CURATED);
  mock.method(tailorCvDeps, "getCuratorPrompt", async (_mode?: string) => ({
    systemPrompt: "Curate with {{MASTER_CV_JSON}}",
    langfusePrompt: {
      name: "cv-curator-json",
      version: 1,
      isFallback: true,
    },
  }));
  mock.method(tailorCvDeps, "compileCuratorPrompt", (prompt: string) => ({
    ok: true as const,
    systemPrompt: prompt,
  }));
  mock.method(
    tailorCvDeps,
    "buildCuratorUserMessage",
    (jd: string) => `JD:\n${jd}`
  );
  mock.method(tailorCvDeps, "chat", async () => ({
    content: strictCuratorJson(FIXTURE_CURATED),
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    model: "anthropic/sonnet",
    finishReason: "stop",
  }));
  mock.method(tailorCvDeps, "isLlmServiceError", () => false);
}

describe("tailorLabeledMessage", () => {
  let memory: ReturnType<typeof createMemoryKv>;

  beforeEach(() => {
    ensureEnv();
    memory = createMemoryKv();
    __injectInboxKvForTest(memory);
    mockPipelineSuccess();
  });

  afterEach(() => {
    mock.restoreAll();
    __injectInboxKvForTest(null);
  });

  it("skips a processed id without calling chat", async () => {
    const marked = await markInboxProcessed(ID, "operator-token");
    assert.equal(marked.ok, true);
    const chatSpy = mock.method(tailorCvDeps, "chat", async () => {
      throw new Error("chat must not run for processed ids");
    });

    const result = await tailorLabeledMessage(tailorCvDeps, {
      messageId: ID,
      message: plainMessage(JD),
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.status, "skipped-processed");
    }
    assert.equal(chatSpy.mock.callCount(), 0);
  });

  it("skips a lost claim without calling chat", async () => {
    const claimed = await claimInboxMessage(ID);
    assert.equal(claimed.ok, true);
    if (claimed.ok) {
      assert.equal(claimed.outcome, "won");
    }
    const chatSpy = mock.method(tailorCvDeps, "chat", async () => {
      throw new Error("chat must not run for claimed ids");
    });

    const result = await tailorLabeledMessage(tailorCvDeps, {
      messageId: ID,
      message: plainMessage(JD),
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.status, "skipped-claimed");
    }
    assert.equal(chatSpy.mock.callCount(), 0);
  });

  it("strict-tailors an extracted JD without rate-limit, Bearer, or processed mark", async () => {
    const rateSpy = mock.method(tailorCvDeps, "checkRateLimit", async () => {
      throw new Error("checkRateLimit must not be called from tailorLabeledMessage");
    });
    const authSpy = mock.method(
      tailorCvDeps,
      "authenticateTailorRequest",
      () => {
        throw new Error(
          "authenticateTailorRequest must not be called from tailorLabeledMessage"
        );
      }
    );
    let seenJd: string | undefined;
    mock.method(
      tailorCvDeps,
      "buildCuratorUserMessage",
      (jd: string) => {
        seenJd = jd;
        return `JD:\n${jd}`;
      }
    );

    const result = await tailorLabeledMessage(tailorCvDeps, {
      messageId: ID,
      message: plainMessage(JD),
    });

    assert.equal(result.ok, true);
    assert.equal(rateSpy.mock.callCount(), 0);
    assert.equal(authSpy.mock.callCount(), 0);
    assert.equal(seenJd, JD);
    assert.equal(memory.store.has(inboxClaimKey(ID)), true);
    assert.equal(memory.store.has(inboxProcessedKey(ID)), false);
    if (result.ok) {
      assert.equal(result.status, "tailored");
      if (result.status === "tailored") {
        assert.equal(typeof result.body.cv, "string");
        assert.ok(result.body.cv.length > 0);
        assert.equal(result.body.builderVersion, BUILDER_VERSION);
        assert.equal(result.body.replyText, DEFAULT_STRICT_REPLY);
        assert.equal(result.body.curationMode, "strict");
        assert.equal("remaining" in result.body, false);
        assert.equal("resetTime" in result.body, false);
        assert.equal(memory.store.get(inboxClaimKey(ID)), result.claimToken);
      }
    }
  });

  it("returns 422 without cv when strict reply_text is blank", async () => {
    mock.method(tailorCvDeps, "chat", async () => ({
      content: strictCuratorJson(FIXTURE_CURATED, "   "),
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      model: "anthropic/sonnet",
      finishReason: "stop",
    }));

    const result = await tailorLabeledMessage(tailorCvDeps, {
      messageId: ID,
      message: plainMessage(JD),
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 422);
      assert.match(result.error, /reply_text/);
    }
    assert.equal(memory.store.has(inboxProcessedKey(ID)), false);
    assert.equal(memory.store.has(inboxClaimKey(ID)), false);
  });

  it("rejects a JD longer than TAILOR_JD_MAX_CHARS without calling chat", async () => {
    const previous = process.env.TAILOR_JD_MAX_CHARS;
    process.env.TAILOR_JD_MAX_CHARS = "8";
    const chatSpy = mock.method(tailorCvDeps, "chat", async () => {
      throw new Error("chat must not run for oversize JD");
    });
    try {
      const result = await tailorLabeledMessage(tailorCvDeps, {
        messageId: ID,
        message: plainMessage("We need a general manager with P&L ownership."),
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.status, 422);
        assert.match(result.error, /size limit/i);
      }
      assert.equal(chatSpy.mock.callCount(), 0);
      assert.equal(memory.store.has(inboxClaimKey(ID)), false);
    } finally {
      if (previous === undefined) delete process.env.TAILOR_JD_MAX_CHARS;
      else process.env.TAILOR_JD_MAX_CHARS = previous;
    }
  });

  it("returns 503 when inbox Redis times out during claim", async () => {
    memory.get = async () => {
      throw new Error("Inbox Redis timed out");
    };
    const chatSpy = mock.method(tailorCvDeps, "chat", async () => {
      throw new Error("chat must not run when Redis times out");
    });
    const result = await tailorLabeledMessage(tailorCvDeps, {
      messageId: ID,
      message: plainMessage(JD),
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 503);
      assert.equal(result.error, "Inbox Redis timed out");
    }
    assert.equal(chatSpy.mock.callCount(), 0);
  });

  it("returns 503 without leaking when getCuratorPrompt rejects", async () => {
    mock.method(tailorCvDeps, "getCuratorPrompt", async () => {
      throw new Error("LANGFUSE_SECRET_KEY is not configured");
    });

    const result = await tailorLabeledMessage(tailorCvDeps, {
      messageId: ID,
      message: plainMessage(JD),
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 503);
      assert.equal(result.error, "AI service error. Please try again.");
      assert.doesNotMatch(result.error, /LANGFUSE_SECRET_KEY/);
    }
    assert.equal(memory.store.has(inboxClaimKey(ID)), false);
    assert.equal(memory.store.has(inboxProcessedKey(ID)), false);
  });

  it("keeps claim ownership when core work outlasts the initial lease", async () => {
    const previous = process.env.INBOX_CLAIM_TTL_SECONDS;
    process.env.INBOX_CLAIM_TTL_SECONDS = "1";
    mock.method(tailorCvDeps, "chat", async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
      return {
        content: strictCuratorJson(FIXTURE_CURATED),
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        model: "anthropic/sonnet",
        finishReason: "stop",
      };
    });
    try {
      const result = await tailorLabeledMessage(tailorCvDeps, {
        messageId: ID,
        message: plainMessage(JD),
      });
      assert.equal(result.ok, true);
      if (result.ok && result.status === "tailored") {
        assert.equal(memory.store.get(inboxClaimKey(ID)), result.claimToken);
      }
    } finally {
      if (previous === undefined) delete process.env.INBOX_CLAIM_TTL_SECONDS;
      else process.env.INBOX_CLAIM_TTL_SECONDS = previous;
    }
  });
});
