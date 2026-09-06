import { describe, it, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  listLabeledRecruiterMail,
  matchGmailLabelId,
  parseGmailMessageList,
} from "../app/api/lib/gmail-list";

const KEYS = [
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
  "GMAIL_REFRESH_TOKEN",
  "GMAIL_RECRUITER_LABEL",
  "GMAIL_OAUTH_TOKEN_URL",
  "GMAIL_API_BASE_URL",
  "GMAIL_LIST_MAX_RESULTS",
  "GMAIL_HTTP_TIMEOUT_MS",
] as const;

const saved: Record<string, string | undefined> = {};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("gmail-list parsers", () => {
  it("matches an exact label name", () => {
    const result = matchGmailLabelId(
      { labels: [{ id: "Label_1", name: "Recruiter" }] },
      "Recruiter"
    );
    assert.equal(result.ok, true);
    assert.equal(result.labelId, "Label_1");
  });

  it("falls back to case-insensitive label match", () => {
    const result = matchGmailLabelId(
      { labels: [{ id: "Label_2", name: "recruiter" }] },
      "Recruiter"
    );
    assert.equal(result.ok, true);
    assert.equal(result.labelId, "Label_2");
  });

  it("fails when the recruiter label is missing", () => {
    const result = matchGmailLabelId(
      { labels: [{ id: "INBOX", name: "INBOX" }] },
      "Recruiter"
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /label not found/);
    }
  });

  it("treats omitted messages as an empty list", () => {
    const result = parseGmailMessageList({});
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.messages, []);
    }
  });

  it("parses id and threadId", () => {
    const result = parseGmailMessageList({
      messages: [{ id: "m1", threadId: "t1" }],
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.messages, [{ id: "m1", threadId: "t1" }]);
    }
  });
});

describe("listLabeledRecruiterMail", () => {
  beforeEach(() => {
    for (const key of KEYS) {
      saved[key] = process.env[key];
    }
    process.env.GMAIL_CLIENT_ID = "client-id";
    process.env.GMAIL_CLIENT_SECRET = "client-secret";
    process.env.GMAIL_REFRESH_TOKEN = "refresh-token";
    process.env.GMAIL_RECRUITER_LABEL = "Recruiter";
    process.env.GMAIL_OAUTH_TOKEN_URL = "https://oauth.example.test/token";
    process.env.GMAIL_API_BASE_URL = "https://gmail.example.test/gmail/v1";
    process.env.GMAIL_LIST_MAX_RESULTS = "10";
  });

  afterEach(() => {
    for (const key of KEYS) {
      const previous = saved[key];
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
  });

  it("lists messages for the recruiter label", async () => {
    const urls: string[] = [];
    const result = await listLabeledRecruiterMail({
      fetchImpl: async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("/token")) {
          return jsonResponse({ access_token: "access" });
        }
        if (url.endsWith("/users/me/labels")) {
          return jsonResponse({
            labels: [{ id: "Label_1", name: "Recruiter" }],
          });
        }
        if (url.includes("/users/me/messages")) {
          const parsed = new URL(url);
          assert.equal(parsed.searchParams.get("labelIds"), "Label_1");
          assert.equal(parsed.searchParams.get("maxResults"), "10");
          return jsonResponse({
            messages: [{ id: "m1", threadId: "t1" }],
          });
        }
        return jsonResponse({}, 404);
      },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.messages, [{ id: "m1", threadId: "t1" }]);
    }
    assert.equal(urls.some((u) => u.includes("/token")), true);
  });

  it("fails closed when the label is missing", async () => {
    const result = await listLabeledRecruiterMail({
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/token")) {
          return jsonResponse({ access_token: "access" });
        }
        if (url.endsWith("/users/me/labels")) {
          return jsonResponse({ labels: [{ id: "INBOX", name: "INBOX" }] });
        }
        throw new Error(`unexpected ${url}`);
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /label not found/);
    }
  });

  it("fails closed when a Gmail list GET is aborted by the HTTP timeout", async () => {
    process.env.GMAIL_HTTP_TIMEOUT_MS = "20";
    const result = await listLabeledRecruiterMail({
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.includes("/token")) {
          return jsonResponse({ access_token: "access" });
        }
        const signal = init?.signal;
        await new Promise<void>((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
        return jsonResponse({});
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /Gmail API request failed|token request failed/);
    }
  });
});
