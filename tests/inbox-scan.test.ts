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
import { scanInbox } from "../app/api/lib/inbox-scan";
import { __clearGmailAccessTokenCacheForTest } from "../app/api/lib/gmail-oauth";
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
  "INBOX_SCAN_ENABLED",
  "INBOX_CLAIM_TTL_SECONDS",
] as const;

const saved: Record<string, string | undefined> = {};

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function recruiterMessage(id = "m1", threadId = "t1"): unknown {
  return {
    id,
    threadId,
    payload: {
      mimeType: "text/plain",
      body: { data: b64("We need a general manager with P&L ownership.") },
      headers: [
        { name: "From", value: "recruiter@example.com" },
        { name: "Subject", value: "GM role" },
        { name: "Message-ID", value: `<${id}@mail>` },
      ],
    },
  };
}

function authorizationHeader(init?: RequestInit): string {
  const headers = init?.headers;
  if (headers instanceof Headers) {
    return headers.get("Authorization") ?? "";
  }
  if (Array.isArray(headers) || headers == null) {
    return "";
  }
  const value = Reflect.get(headers, "Authorization");
  return typeof value === "string" ? value : "";
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
    expireIfOwned: async (key, value) => store.get(key) === value,
    markProcessedIfOwned: async (claimKey, processedKey, token) => {
      if (store.get(claimKey) !== token) {
        return false;
      }
      store.set(processedKey, "1");
      store.delete(claimKey);
      return true;
    },
  };
  return memory;
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
  delayDraftMs?: number;
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
      const delayMs = options.delayDraftMs ?? 0;
      if (delayMs > 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delayMs);
          init.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("The operation was aborted", "AbortError"));
          });
        });
      }
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
    process.env.INBOX_SCAN_ENABLED = "1";
    process.env.GMAIL_CLIENT_ID = "client-id";
    process.env.GMAIL_CLIENT_SECRET = "client-secret";
    process.env.GMAIL_REFRESH_TOKEN = "refresh-token";
    process.env.GMAIL_RECRUITER_LABEL = "Recruiter";
    process.env.GMAIL_OAUTH_TOKEN_URL = "https://oauth.example.test/token";
    process.env.GMAIL_API_BASE_URL = "https://gmail.example.test/gmail/v1";
    process.env.GMAIL_LIST_MAX_RESULTS = "10";
    process.env.GMAIL_CV_ATTACHMENT_FILENAME = "CV.docx";
    __clearGmailAccessTokenCacheForTest();
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

  it("does not call Gmail when INBOX_SCAN_ENABLED is off", async () => {
    delete process.env.INBOX_SCAN_ENABLED;
    let fetches = 0;
    const result = await scanInbox({
      fetchImpl: async () => {
        fetches += 1;
        throw new Error("must not fetch");
      },
      tailorDeps: tailorCvDeps,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /INBOX_SCAN_ENABLED/);
    }
    assert.equal(fetches, 0);
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

  it("does not report drafted when the processed mark fails", async () => {
    memory.markProcessedIfOwned = async () => false;
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
      assert.equal(result.items[0]?.status, "draft-failed");
      assert.match(result.items[0]?.error ?? "", /claim/i);
    }
    assert.equal(draftCreates, 1);
    assert.equal(memory.store.has(inboxProcessedKey("m1")), false);
  });

  it("does not create a draft when claim ownership is lost immediately beforehand", async () => {
    let renewals = 0;
    memory.expireIfOwned = async (key, value) => {
      renewals += 1;
      if (renewals === 2) {
        memory.store.set(key, "replacement-token");
      }
      return memory.store.get(key) === value;
    };
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
      assert.deepEqual(result.items, [
        { messageId: "m1", status: "skipped-claimed" },
      ]);
    }
    assert.equal(renewals, 2);
    assert.equal(draftCreates, 0);
    assert.equal(memory.store.has(inboxProcessedKey("m1")), false);
  });

  it("stops drafting when claim ownership is lost while the draft request is in flight", async () => {
    process.env.INBOX_CLAIM_TTL_SECONDS = "1";
    let renewals = 0;
    memory.expireIfOwned = async (key, value) => {
      renewals += 1;
      if (renewals >= 3) {
        memory.store.set(key, "replacement-token");
      }
      return memory.store.get(key) === value;
    };
    let draftCreates = 0;
    const result = await scanInbox({
      fetchImpl: gmailFetch({
        onDraftCreate: () => {
          draftCreates += 1;
        },
        delayDraftMs: 900,
      }),
      tailorDeps: tailorCvDeps,
      sleep: async () => undefined,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.notEqual(result.items[0]?.status, "drafted");
    }
    assert.equal(draftCreates, 0);
    assert.ok(renewals >= 3);
    assert.equal(memory.store.has(inboxProcessedKey("m1")), false);
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
    const claimed = await claimInboxMessage("m1");
    assert.equal(claimed.ok, true);
    if (!claimed.ok || claimed.outcome !== "won") {
      assert.fail("expected to win the claim");
    }
    const marked = await markInboxProcessed("m1", claimed.token);
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

  it("creates one draft when two labeled messages share a thread", async () => {
    let creates = 0;
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
      if (parsed.pathname.endsWith("/users/me/drafts") && init?.method === "POST") {
        creates += 1;
        return jsonResponse({ id: "draft1" });
      }
      if (parsed.pathname.includes("/users/me/threads/")) {
        return jsonResponse({
          messages:
            creates > 0
              ? [{ id: "d1", labelIds: ["DRAFT"] }]
              : [{ id: "m", labelIds: ["INBOX"] }],
        });
      }
      const messageMatch = parsed.pathname.match(/\/users\/me\/messages\/([^/]+)$/);
      if (messageMatch?.[1] !== undefined) {
        return jsonResponse(recruiterMessage(messageMatch[1], "t1"));
      }
      if (parsed.pathname.endsWith("/users/me/messages")) {
        return jsonResponse({
          messages: [
            { id: "m1", threadId: "t1" },
            { id: "m2", threadId: "t1" },
          ],
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
      assert.deepEqual(
        result.items.map((item) => item.status),
        ["drafted", "reused-draft"]
      );
    }
    assert.equal(creates, 1);
    assert.equal(memory.store.has(inboxProcessedKey("m1")), true);
    assert.equal(memory.store.has(inboxProcessedKey("m2")), true);
  });

  it("does not create a second draft when overlapping scans share a thread", { timeout: 5000 }, async () => {
    let creates = 0;
    let createChecks = 0;
    let settled = 0;
    let overlap = false;
    let releaseTailor: () => void = () => undefined;
    const tailorGate = new Promise<void>((resolve) => {
      releaseTailor = resolve;
    });
    let tailorCalls = 0;
    mock.method(tailorCvDeps, "chat", async () => {
      tailorCalls += 1;
      if (tailorCalls === 1) {
        await tailorGate;
      }
      return {
        content: strictCuratorJson(FIXTURE_CURATED),
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        model: "anthropic/sonnet",
        finishReason: "stop",
      };
    });
    const waiters: Array<() => void> = [];
    const releaseWaiters = (): void => {
      const pending = waiters.splice(0, waiters.length);
      for (const resolve of pending) resolve();
    };
    const noDraft = (): Response =>
      jsonResponse({ messages: [{ id: "m", labelIds: ["INBOX"] }] });
    const withDraft = (): Response =>
      jsonResponse({ messages: [{ id: "d1", labelIds: ["DRAFT"] }] });
    const postTailorThreadRead = async (): Promise<Response> => {
      createChecks += 1;
      if (createChecks >= 2) {
        overlap = true;
        releaseWaiters();
        return noDraft();
      }
      if (settled > 0) {
        return creates > 0 ? withDraft() : noDraft();
      }
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
      if (overlap) return noDraft();
      return creates > 0 ? withDraft() : noDraft();
    };
    const fetchFor = (messageId: string) => {
      let threadGets = 0;
      return async (input: string | URL, init?: RequestInit) => {
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
          creates += 1;
          return jsonResponse({ id: `draft-${creates}` });
        }
        if (parsed.pathname.includes("/users/me/threads/")) {
          threadGets += 1;
          if (threadGets >= 2) {
            return postTailorThreadRead();
          }
          return noDraft();
        }
        const messageMatch = parsed.pathname.match(/\/users\/me\/messages\/([^/]+)$/);
        if (messageMatch?.[1] !== undefined) {
          return jsonResponse(recruiterMessage(messageMatch[1], "t1"));
        }
        if (parsed.pathname.endsWith("/users/me/messages")) {
          return jsonResponse({
            messages: [{ id: messageId, threadId: "t1" }],
          });
        }
        throw new Error(`unexpected ${url}`);
      };
    };
    const run = (messageId: string) =>
      scanInbox({
        fetchImpl: fetchFor(messageId),
        tailorDeps: tailorCvDeps,
        sleep: async () => undefined,
      }).finally(() => {
        settled += 1;
        releaseWaiters();
        releaseTailor();
      });
    const [first, second] = await Promise.all([run("m1"), run("m2")]);
    assert.equal(first.ok && second.ok, true);
    if (first.ok && second.ok) {
      const statuses = [first.items[0]?.status, second.items[0]?.status].sort();
      assert.deepEqual(statuses, ["drafted", "skipped-claimed"]);
    }
    assert.equal(creates, 1);
    const processed = ["m1", "m2"].filter((id) =>
      memory.store.has(inboxProcessedKey(id))
    );
    assert.equal(processed.length, 1);
    const threadClaims = [...memory.store.keys()].filter((key) =>
      key.includes(":thread-claim:")
    );
    assert.deepEqual(threadClaims, []);
  });

  it("does not create a draft when the thread claim is lost before create", async () => {
    memory.expireIfOwned = async (key, value) => {
      if (key.includes(":thread-claim:")) {
        return false;
      }
      return memory.store.get(key) === value;
    };
    let creates = 0;
    const result = await scanInbox({
      fetchImpl: gmailFetch({
        onDraftCreate: () => {
          creates += 1;
        },
      }),
      tailorDeps: tailorCvDeps,
      sleep: async () => undefined,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.items[0]?.status, "skipped-claimed");
    }
    assert.equal(creates, 0);
    assert.equal(memory.store.has(inboxProcessedKey("m1")), false);
    assert.equal(memory.store.has(inboxClaimKey("m1")), false);
  });

  it("refreshes the Gmail access token after tailor before drafts.create", async () => {
    const tokens: string[] = [];
    let messageBearer = "";
    let draftBearer = "";
    const fetchImpl = async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const parsed = new URL(url);
      if (url.includes("/token")) {
        const accessToken = `tok-${tokens.length + 1}`;
        tokens.push(accessToken);
        return jsonResponse({ access_token: accessToken });
      }
      if (parsed.pathname.endsWith("/users/me/labels")) {
        return jsonResponse({
          labels: [{ id: "Label_1", name: "Recruiter" }],
        });
      }
      if (parsed.pathname.endsWith("/users/me/drafts") && init?.method === "POST") {
        draftBearer = authorizationHeader(init);
        return jsonResponse({ id: "draft1" });
      }
      if (parsed.pathname.includes("/users/me/threads/")) {
        return jsonResponse({
          messages: [{ id: "m1", labelIds: ["INBOX"] }],
        });
      }
      if (/\/users\/me\/messages\/[^/]+$/.test(parsed.pathname)) {
        messageBearer = authorizationHeader(init);
        return jsonResponse(recruiterMessage());
      }
      if (parsed.pathname.endsWith("/users/me/messages")) {
        return jsonResponse({
          messages: [{ id: "m1", threadId: "t1" }],
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
      assert.equal(result.items[0]?.status, "drafted");
    }
    assert.equal(messageBearer, "Bearer tok-2");
    assert.equal(draftBearer, "Bearer tok-3");
  });
});
