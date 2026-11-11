import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  getGmailMessage,
  parseGmailReplyHeaders,
} from "../app/api/lib/gmail-message";

const GMAIL_ENV_KEYS = [
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
  "GMAIL_REFRESH_TOKEN",
  "GMAIL_OAUTH_TOKEN_URL",
  "GMAIL_API_BASE_URL",
] as const;

function authorizationHeader(init?: RequestInit): string | undefined {
  const headers = init?.headers;
  if (headers === undefined) {
    return undefined;
  }
  if (headers instanceof Headers) {
    return headers.get("Authorization") ?? undefined;
  }
  if (Array.isArray(headers)) {
    for (const [name, value] of headers) {
      if (name.toLowerCase() === "authorization") {
        return value;
      }
    }
    return undefined;
  }
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === "authorization") {
      return value;
    }
  }
  return undefined;
}

describe("parseGmailReplyHeaders", () => {
  it("maps From to To and prefixes Re: when needed", () => {
    const result = parseGmailReplyHeaders({
      threadId: "t1",
      payload: {
        headers: [
          { name: "From", value: "recruiter@example.com" },
          { name: "Subject", value: "GM role" },
          { name: "Message-ID", value: "<id@mail>" },
        ],
      },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.headers, {
        to: "recruiter@example.com",
        subject: "Re: GM role",
        threadId: "t1",
        inReplyTo: "<id@mail>",
      });
    }
  });

  it("keeps an existing Re: subject", () => {
    const result = parseGmailReplyHeaders({
      threadId: "t1",
      payload: {
        headers: [
          { name: "From", value: "a@b.com" },
          { name: "Subject", value: "Re: already" },
        ],
      },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.headers.subject, "Re: already");
      assert.equal(result.headers.inReplyTo, undefined);
    }
  });

  it("fails closed without From", () => {
    const result = parseGmailReplyHeaders({
      threadId: "t1",
      payload: { headers: [{ name: "Subject", value: "Hi" }] },
    });
    assert.equal(result.ok, false);
  });

  it("fails closed when threadId is missing", () => {
    const result = parseGmailReplyHeaders({
      payload: {
        headers: [{ name: "From", value: "recruiter@example.com" }],
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /threadId/);
    }
  });

  it("fails closed when threadId is blank", () => {
    const result = parseGmailReplyHeaders({
      threadId: "  ",
      payload: {
        headers: [{ name: "From", value: "recruiter@example.com" }],
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /threadId/);
    }
  });

  it("fails closed when payload.headers is missing", () => {
    const result = parseGmailReplyHeaders({
      threadId: "t1",
      payload: {},
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /From/);
    }
  });

  it("fails closed when From is blank", () => {
    const result = parseGmailReplyHeaders({
      threadId: "t1",
      payload: { headers: [{ name: "From", value: "   " }] },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /From/);
    }
  });

  it("fails closed when From is not a string", () => {
    const result = parseGmailReplyHeaders({
      threadId: "t1",
      payload: { headers: [{ name: "From", value: 42 }] },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /From/);
    }
  });

  it("fails closed when Reply-To is blank and From is missing", () => {
    const result = parseGmailReplyHeaders({
      threadId: "t1",
      payload: { headers: [{ name: "Reply-To", value: "" }] },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /From/);
    }
  });

  it("fails closed when Reply-To is not a string and From is missing", () => {
    const result = parseGmailReplyHeaders({
      threadId: "t1",
      payload: { headers: [{ name: "Reply-To", value: null }] },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /From/);
    }
  });

  it("prefers Reply-To over From", () => {
    const result = parseGmailReplyHeaders({
      threadId: "t1",
      payload: {
        headers: [
          { name: "From", value: "via@mailer.example" },
          { name: "Reply-To", value: "recruiter@example.com" },
          { name: "Subject", value: "GM role" },
        ],
      },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.headers.to, "recruiter@example.com");
    }
  });

  it("strips CR/LF from header values used as MIME fields", () => {
    const result = parseGmailReplyHeaders({
      threadId: "t1",
      payload: {
        headers: [
          { name: "From", value: "recruiter@example.com\r\nBcc: evil@x.com" },
          { name: "Subject", value: "GM\nrole" },
          { name: "Message-ID", value: "<id@mail>\r\nX-Injected: 1" },
        ],
      },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.headers.to.includes("\n"), false);
      assert.equal(result.headers.to.includes("\r"), false);
      assert.equal(result.headers.subject.includes("\n"), false);
      assert.equal(result.headers.inReplyTo?.includes("\r"), false);
      assert.equal(result.headers.inReplyTo?.includes("\n"), false);
    }
  });
});

describe("getGmailMessage", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of GMAIL_ENV_KEYS) {
      saved[key] = process.env[key];
    }
    process.env.GMAIL_CLIENT_ID = "client-id";
    process.env.GMAIL_CLIENT_SECRET = "client-secret";
    process.env.GMAIL_REFRESH_TOKEN = "refresh-token";
    process.env.GMAIL_OAUTH_TOKEN_URL = "https://oauth.example.test/token";
    process.env.GMAIL_API_BASE_URL = "https://gmail.example.test/gmail/v1";
  });

  afterEach(() => {
    for (const key of GMAIL_ENV_KEYS) {
      const previous = saved[key];
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  });

  it("rejects an invalid messageId before calling Gmail", async () => {
    let fetchCalls = 0;
    const result = await getGmailMessage({
      messageId: "bad:id",
      accessToken: "token",
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response("{}");
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /unsupported characters/);
    }
    assert.equal(fetchCalls, 0);
  });

  it("rejects an empty messageId before token refresh", async () => {
    let fetchCalls = 0;
    const result = await getGmailMessage({
      messageId: "  ",
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response("{}");
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /required/);
    }
    assert.equal(fetchCalls, 0);
  });

  it("loads a valid message with bearer auth and format=full", async () => {
    const message = { id: "msg123abc", threadId: "t1" };
    let requested = "";
    const result = await getGmailMessage({
      messageId: "msg123abc",
      accessToken: "access-token",
      fetchImpl: async (input, init) => {
        requested = String(input);
        assert.equal(init?.method, "GET");
        assert.equal(authorizationHeader(init), "Bearer access-token");
        return new Response(JSON.stringify(message));
      },
    });
    const url = new URL(requested);
    assert.equal(url.origin, "https://gmail.example.test");
    assert.equal(url.pathname, "/gmail/v1/users/me/messages/msg123abc");
    assert.equal(url.searchParams.get("format"), "full");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.message, message);
    }
  });

  it("returns the Gmail status when the message request fails", async () => {
    const result = await getGmailMessage({
      messageId: "msg123abc",
      accessToken: "access-token",
      fetchImpl: async () => new Response("{}", { status: 404 }),
    });
    assert.deepEqual(result, { ok: false, error: "Gmail API HTTP 404" });
  });

  it("returns a request failure when Gmail fetch throws", async () => {
    const result = await getGmailMessage({
      messageId: "msg123abc",
      accessToken: "access-token",
      fetchImpl: async () => {
        throw new Error("socket hang up");
      },
    });
    assert.deepEqual(result, { ok: false, error: "Gmail API request failed" });
  });

  it("returns the token error and does not call Gmail when refresh fails", async () => {
    let gmailCalls = 0;
    const result = await getGmailMessage({
      messageId: "msg123abc",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url === "https://oauth.example.test/token") {
          return new Response("{}", { status: 401 });
        }
        gmailCalls += 1;
        return new Response("{}");
      },
    });
    assert.deepEqual(result, { ok: false, error: "Gmail token HTTP 401" });
    assert.equal(gmailCalls, 0);
  });
});
