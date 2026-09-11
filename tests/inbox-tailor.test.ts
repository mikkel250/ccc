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
  const memory: InboxKv & { store: Map<string, string> } = {
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
    deleteIfValue: async (key, value) => {
      if (store.get(key) !== value) {
        return false;
      }
      store.delete(key);
      return true;
    },
    expireIfValue: async (key: string, value: string) =>
      store.get(key) === value,
  };
  return memory;
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
    const marked = await markInboxProcessed(ID);
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

  it("stops when the claim expires while runTailorCore is running", async () => {
    mock.method(tailorCvDeps, "chat", async () => {
      memory.store.set(inboxClaimKey(ID), "replacement-token");
      return {
        content: strictCuratorJson(FIXTURE_CURATED),
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        model: "anthropic/sonnet",
        finishReason: "stop",
      };
    });

    const result = await tailorLabeledMessage(tailorCvDeps, {
      messageId: ID,
      message: plainMessage(JD),
    });

    assert.deepEqual(result, { ok: true, status: "skipped-claimed" });
    assert.equal(memory.store.get(inboxClaimKey(ID)), "replacement-token");
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
      assert.equal(memory.store.has(inboxClaimKey(ID)), true);
    } finally {
      if (previous === undefined) delete process.env.TAILOR_JD_MAX_CHARS;
      else process.env.TAILOR_JD_MAX_CHARS = previous;
    }
  });
});
