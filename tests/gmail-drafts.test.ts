import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  buildReplyRfc822,
  ensureReplyDraft,
  threadContainsDraft,
} from "../app/api/lib/gmail-drafts";

const KEYS = [
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
  "GMAIL_REFRESH_TOKEN",
  "GMAIL_OAUTH_TOKEN_URL",
  "GMAIL_API_BASE_URL",
  "GMAIL_CV_ATTACHMENT_FILENAME",
] as const;

const saved: Record<string, string | undefined> = {};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sourceMessage(): unknown {
  return {
    threadId: "t1",
    payload: {
      headers: [
        { name: "From", value: "recruiter@example.com" },
        { name: "Subject", value: "Role" },
        { name: "Message-ID", value: "<m@mail>" },
      ],
    },
  };
}

describe("gmail draft MIME and reuse", () => {
  it("embeds reply body and attachment filename", () => {
    const rfc = buildReplyRfc822({
      to: "recruiter@example.com",
      subject: "Re: Role",
      body: "Thanks for reaching out.",
      attachmentFilename: "CV.docx",
      docxBase64: "QQ==",
      boundary: "ccc-test",
      inReplyTo: "<m@mail>",
    });
    assert.match(rfc, /Thanks for reaching out\./);
    assert.match(rfc, /filename="CV\.docx"/);
    assert.match(rfc, /In-Reply-To: <m@mail>/);
    assert.match(rfc, /QQ==/);
  });

  it("strips CR/LF from MIME header values", () => {
    const rfc = buildReplyRfc822({
      to: "recruiter@example.com\r\nBcc: evil@x.com",
      subject: "Re: Role\nX-Injected: 1",
      body: "Thanks",
      attachmentFilename: "CV.docx",
      docxBase64: "QQ==",
      boundary: "ccc-test",
      inReplyTo: "<m@mail>\r\nCc: evil@x.com",
    });
    const headerBlock = rfc.split("\r\n\r\n")[0] ?? rfc;
    assert.doesNotMatch(headerBlock, /Bcc: evil/);
    assert.doesNotMatch(headerBlock, /X-Injected/);
    assert.doesNotMatch(headerBlock, /Cc: evil/);
  });

  it("detects a DRAFT-labeled thread message", () => {
    assert.equal(
      threadContainsDraft({
        messages: [{ id: "d1", labelIds: ["DRAFT"] }],
      }),
      true
    );
    assert.equal(
      threadContainsDraft({
        messages: [{ id: "m1", labelIds: ["INBOX"] }],
      }),
      false
    );
  });
});

describe("ensureReplyDraft", () => {
  beforeEach(() => {
    for (const key of KEYS) {
      saved[key] = process.env[key];
    }
    process.env.GMAIL_CLIENT_ID = "client-id";
    process.env.GMAIL_CLIENT_SECRET = "client-secret";
    process.env.GMAIL_REFRESH_TOKEN = "refresh-token";
    process.env.GMAIL_OAUTH_TOKEN_URL = "https://oauth.example.test/token";
    process.env.GMAIL_API_BASE_URL = "https://gmail.example.test/gmail/v1";
    process.env.GMAIL_CV_ATTACHMENT_FILENAME = "CV.docx";
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

  it("reuses an existing thread draft without POST /drafts", async () => {
    const methods: string[] = [];
    const result = await ensureReplyDraft({
      sourceMessage: sourceMessage(),
      replyText: "Thanks",
      docxBase64: "QQ==",
      fetchImpl: async (input, init) => {
        const url = String(input);
        methods.push(`${init?.method ?? "GET"} ${url}`);
        if (url.includes("/token")) {
          return jsonResponse({ access_token: "access" });
        }
        if (url.includes("/threads/t1")) {
          return jsonResponse({
            messages: [{ id: "d1", labelIds: ["DRAFT"] }],
          });
        }
        throw new Error(`unexpected ${url}`);
      },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.status, "reused");
    }
    assert.equal(methods.some((m) => m.includes("/drafts")), false);
  });

  it("creates a draft when the thread has none", async () => {
    let createdRaw: unknown;
    const result = await ensureReplyDraft({
      sourceMessage: sourceMessage(),
      replyText: "Thanks for reaching out.",
      docxBase64: "QQ==",
      boundary: "ccc-test",
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.includes("/token")) {
          return jsonResponse({ access_token: "access" });
        }
        if (url.includes("/threads/t1")) {
          return jsonResponse({
            messages: [{ id: "m1", labelIds: ["INBOX"] }],
          });
        }
        if (url.endsWith("/users/me/drafts") && init?.method === "POST") {
          createdRaw = JSON.parse(String(init.body));
          return jsonResponse({ id: "draft1" });
        }
        throw new Error(`unexpected ${url}`);
      },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.status, "created");
    }
    assert.equal(createdRaw !== undefined, true);
    const body = createdRaw as { message: { threadId: string; raw: string } };
    assert.equal(body.message.threadId, "t1");
    const rfc = Buffer.from(body.message.raw, "base64url").toString("utf8");
    assert.match(rfc, /Thanks for reaching out\./);
    assert.match(rfc, /filename="CV\.docx"/);
  });

  it("skips token refresh when an access token is provided", async () => {
    let tokenPosts = 0;
    const result = await ensureReplyDraft({
      sourceMessage: sourceMessage(),
      replyText: "Thanks for reaching out.",
      docxBase64: "QQ==",
      boundary: "ccc-test",
      accessToken: "already-fresh",
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.includes("/token")) {
          tokenPosts += 1;
          throw new Error("token refresh must not run when accessToken is set");
        }
        if (url.includes("/threads/t1")) {
          return jsonResponse({
            messages: [{ id: "m1", labelIds: ["INBOX"] }],
          });
        }
        if (url.endsWith("/users/me/drafts") && init?.method === "POST") {
          return jsonResponse({ id: "draft1" });
        }
        throw new Error(`unexpected ${url}`);
      },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.status, "created");
    }
    assert.equal(tokenPosts, 0);
  });

  it("does not create a stub draft when reply text is blank", async () => {
    const result = await ensureReplyDraft({
      sourceMessage: sourceMessage(),
      replyText: "   ",
      docxBase64: "QQ==",
      fetchImpl: async () => {
        throw new Error("fetch must not run for blank reply");
      },
    });
    assert.equal(result.ok, false);
  });

  it("returns ok false when the CV attachment filename is invalid", async () => {
    process.env.GMAIL_CV_ATTACHMENT_FILENAME = "../secret.docx";
    const result = await ensureReplyDraft({
      sourceMessage: sourceMessage(),
      replyText: "Thanks for reaching out.",
      docxBase64: "QQ==",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/token")) {
          return jsonResponse({ access_token: "access" });
        }
        if (url.includes("/threads/t1")) {
          return jsonResponse({
            messages: [{ id: "m1", labelIds: ["INBOX"] }],
          });
        }
        throw new Error("drafts.create must not run for invalid filename");
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /filename/i);
    }
  });
});
