import { describe, it, mock, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tailorCvDeps } from "../app/api/lib/tailor-cv-deps";
import {
  __injectInboxKvForTest,
  inboxClaimKey,
  inboxProcessedKey,
  markInboxProcessed,
  type InboxKv,
} from "../app/api/lib/inbox-processed-store";
import { scanInbox } from "../app/api/lib/inbox-scan";
import { strictCuratorJson } from "../tests/helpers/strict-curator";
import { ensureEnv } from "../tests/helpers/tailor-request";

const FIXTURE_CURATED = JSON.parse(
  readFileSync(
    join(process.cwd(), "tests/fixtures/curated-cv-valid.json"),
    "utf8"
  )
) as Record<string, unknown>;

const GMAIL_KEYS = [
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
  "GMAIL_REFRESH_TOKEN",
  "GMAIL_RECRUITER_LABEL",
  "GMAIL_OAUTH_TOKEN_URL",
  "GMAIL_API_BASE_URL",
  "GMAIL_LIST_MAX_RESULTS",
  "GMAIL_CV_ATTACHMENT_FILENAME",
  "INBOX_SCAN_BACKOFF_MS",
] as const;

const saved: Record<string, string | undefined> = {};

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function recruiterMessage(): unknown {
  return {
    id: "m1",
    threadId: "t1",
    payload: {
      mimeType: "text/plain",
      body: { data: b64("We need a general manager with P&L ownership.") },
      headers: [
        { name: "From", value: "recruiter@example.com" },
        { name: "Subject", value: "GM role" },
        { name: "Message-ID", value: "<m@mail>" },
      ],
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
    deleteIfValue: async (key, value) => {
      if (store.get(key) !== value) {
        return false;
      }
      store.delete(key);
      return true;
    },
  };
}

function mockPipelineSuccess(): void {
  mock.method(tailorCvDeps, "requireMasterCv", () => FIXTURE_CURATED);
  mock.method(tailorCvDeps, "getCuratorPrompt", async () => ({
    systemPrompt: "Curate with {{MASTER_CV_JSON}}",
    langfusePrompt: { name: "cv-curator-json", version: 1, isFallback: true },
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

function gmailFetch(options: {
  threadDraft?: boolean;
  onDraftCreate?: () => void;
  onMessageGet?: () => void;
}): (input: string | URL, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const url = String(input);
    const parsed = new URL(url);
    if (url.includes("/token")) {
      return jsonResponse({ access_token: "access" });
    }
    if (parsed.pathname.endsWith("/users/me/labels")) {
      return jsonResponse({
        labels: [{ id: "Label_1", name: "Recruiter" }],
      });
    }
    if (parsed.pathname.endsWith("/users/me/drafts") && init?.method === "POST") {
      options.onDraftCreate?.();
      return jsonResponse({ id: "draft1" });
    }
    if (parsed.pathname.includes("/users/me/threads/")) {
      return jsonResponse({
        messages: options.threadDraft
          ? [{ id: "d1", labelIds: ["DRAFT"] }]
          : [{ id: "m1", labelIds: ["INBOX"] }],
      });
    }
    if (/\/users\/me\/messages\/[^/]+$/.test(parsed.pathname)) {
      options.onMessageGet?.();
      return jsonResponse(recruiterMessage());
    }
    if (parsed.pathname.endsWith("/users/me/messages")) {
      return jsonResponse({
        messages: [{ id: "m1", threadId: "t1" }],
      });
    }
    throw new Error(`unexpected ${url}`);
  };
}

describe("scanInbox", () => {
  let memory: ReturnType<typeof createMemoryKv>;

  beforeEach(() => {
    ensureEnv();
    memory = createMemoryKv();
    __injectInboxKvForTest(memory);
    mockPipelineSuccess();
    for (const key of GMAIL_KEYS) {
      saved[key] = process.env[key];
    }
    process.env.INBOX_SCAN_BACKOFF_MS = "0";
    process.env.GMAIL_CLIENT_ID = "client-id";
    process.env.GMAIL_CLIENT_SECRET = "client-secret";
    process.env.GMAIL_REFRESH_TOKEN = "refresh-token";
    process.env.GMAIL_RECRUITER_LABEL = "Recruiter";
    process.env.GMAIL_OAUTH_TOKEN_URL = "https://oauth.example.test/token";
    process.env.GMAIL_API_BASE_URL = "https://gmail.example.test/gmail/v1";
    process.env.GMAIL_LIST_MAX_RESULTS = "10";
    process.env.GMAIL_CV_ATTACHMENT_FILENAME = "CV.docx";
  });

  afterEach(() => {
    mock.restoreAll();
    __injectInboxKvForTest(null);
    for (const key of GMAIL_KEYS) {
      const previous = saved[key];
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
  });

  it("creates a draft and marks processed after a successful tailor", async () => {
    let draftCreates = 0;
    const result = await scanInbox({
      fetchImpl: gmailFetch({ onDraftCreate: () => {
        draftCreates += 1;
      } }),
      tailorDeps: tailorCvDeps,
      sleep: async () => undefined,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.items, [{ messageId: "m1", status: "drafted" }]);
    }
    assert.equal(draftCreates, 1);
    assert.equal(memory.store.has(inboxProcessedKey("m1")), true);
  });

  it("reuses an existing thread draft without tailoring and still marks processed", async () => {
    let draftCreates = 0;
    const chatSpy = mock.method(tailorCvDeps, "chat", async () => {
      throw new Error("chat must not run when a thread draft already exists");
    });
    const result = await scanInbox({
      fetchImpl: gmailFetch({
        threadDraft: true,
        onDraftCreate: () => {
          draftCreates += 1;
        },
      }),
      tailorDeps: tailorCvDeps,
      sleep: async () => undefined,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.items[0]?.status, "reused-draft");
    }
    assert.equal(draftCreates, 0);
    assert.equal(chatSpy.mock.callCount(), 0);
    assert.equal(memory.store.has(inboxProcessedKey("m1")), true);
  });

  it("does not create a draft when strict reply_text is blank", async () => {
    mock.method(tailorCvDeps, "chat", async () => ({
      content: strictCuratorJson(FIXTURE_CURATED, "   "),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      model: "anthropic/sonnet",
      finishReason: "stop",
    }));
    let draftCreates = 0;
    const result = await scanInbox({
      fetchImpl: gmailFetch({
        onDraftCreate: () => {
          draftCreates += 1;
        },
      }),
      tailorDeps: tailorCvDeps,
      sleep: async () => undefined,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.items[0]?.status, "tailor-failed");
    }
    assert.equal(draftCreates, 0);
    assert.equal(memory.store.has(inboxProcessedKey("m1")), false);
  });

  it("skips processed ids without fetching the message", async () => {
    const marked = await markInboxProcessed("m1");
    assert.equal(marked.ok, true);
    let gets = 0;
    const chatSpy = mock.method(tailorCvDeps, "chat", async () => {
      throw new Error("chat must not run for processed ids");
    });
    const result = await scanInbox({
      fetchImpl: gmailFetch({
        onMessageGet: () => {
          gets += 1;
        },
      }),
      tailorDeps: tailorCvDeps,
      sleep: async () => undefined,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.items[0]?.status, "skipped-processed");
    }
    assert.equal(gets, 0);
    assert.equal(chatSpy.mock.callCount(), 0);
  });

  it("releases the claim when drafts.create fails so a later scan can retry", async () => {
    let draftPosts = 0;
    const failingFetch = gmailFetch({
      onDraftCreate: () => {
        draftPosts += 1;
        throw new Error("stop");
      },
    });
    const firstFetch: typeof failingFetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/users/me/drafts") && init?.method === "POST") {
        draftPosts += 1;
        return jsonResponse({ error: "boom" }, 500);
      }
      return failingFetch(input, init);
    };
    const first = await scanInbox({
      fetchImpl: firstFetch,
      tailorDeps: tailorCvDeps,
      sleep: async () => undefined,
    });
    assert.equal(first.ok, true);
    if (first.ok) {
      assert.equal(first.items[0]?.status, "draft-failed");
    }
    assert.equal(memory.store.has(inboxProcessedKey("m1")), false);
    assert.equal(memory.store.has(inboxClaimKey("m1")), false);

    let created = 0;
    const second = await scanInbox({
      fetchImpl: gmailFetch({
        onDraftCreate: () => {
          created += 1;
        },
      }),
      tailorDeps: tailorCvDeps,
      sleep: async () => undefined,
    });
    assert.equal(second.ok, true);
    if (second.ok) {
      assert.equal(second.items[0]?.status, "drafted");
    }
    assert.equal(created, 1);
    assert.equal(draftPosts, 1);
    assert.equal(memory.store.has(inboxProcessedKey("m1")), true);
  });

  it("continues the scan when one message throws", async () => {
    let listed = 0;
    const fetchImpl = async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const parsed = new URL(url);
      if (url.includes("/token")) {
        return jsonResponse({ access_token: "access" });
      }
      if (parsed.pathname.endsWith("/users/me/labels")) {
        return jsonResponse({
          labels: [{ id: "Label_1", name: "Recruiter" }],
        });
      }
      if (parsed.pathname.endsWith("/users/me/messages")) {
        return jsonResponse({
          messages: [
            { id: "m1", threadId: "t1" },
            { id: "m2", threadId: "t2" },
          ],
        });
      }
      if (parsed.pathname.endsWith("/users/me/drafts") && init?.method === "POST") {
        return jsonResponse({ id: "draft1" });
      }
      if (parsed.pathname.includes("/users/me/threads/")) {
        return jsonResponse({
          messages: [{ id: "m", labelIds: ["INBOX"] }],
        });
      }
      if (/\/users\/me\/messages\/m1$/.test(parsed.pathname)) {
        throw new Error("transient get failure");
      }
      if (/\/users\/me\/messages\/m2$/.test(parsed.pathname)) {
        listed += 1;
        return jsonResponse({
          id: "m2",
          threadId: "t2",
          payload: {
            mimeType: "text/plain",
            body: { data: b64("We need a general manager with P&L ownership.") },
            headers: [
              { name: "From", value: "recruiter@example.com" },
              { name: "Subject", value: "GM role" },
              { name: "Message-ID", value: "<m2@mail>" },
            ],
          },
        });
      }
      throw new Error(`unexpected ${url}`);
    };
    const result = await scanInbox({
      fetchImpl,
      tailorDeps: tailorCvDeps,
      sleep: async () => undefined,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.items.length, 2);
      assert.equal(result.items[0]?.status, "fetch-failed");
      assert.equal(result.items[1]?.status, "drafted");
    }
    assert.equal(listed, 1);
  });
});
