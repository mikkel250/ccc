import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  applyLocalInboxGmailEnv,
  assertLocalInboxGmailUrlsAreHttps,
  createGmailFetchFixture,
} from "../dev/gmail-fetch-fixture";

const GMAIL_ENV = [
  "INBOX_SCAN_ENABLED",
  "GMAIL_CLIENT_ID",
  "GMAIL_OAUTH_TOKEN_URL",
  "GMAIL_API_BASE_URL",
] as const;

describe("createGmailFetchFixture", () => {
  it("answers the production HTTPS Gmail token and list URLs", async () => {
    const fetchImpl = createGmailFetchFixture();
    const token = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
    });
    assert.equal(token.status, 200);
    const tokenBody = (await token.json()) as { access_token: string };
    assert.equal(tokenBody.access_token, "local-mock-access");

    const listed = await fetchImpl(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=Label_recruiter"
    );
    assert.equal(listed.status, 200);
    const listedBody = (await listed.json()) as {
      messages: Array<{ id: string }>;
    };
    assert.equal(listedBody.messages[0]?.id, "local-mock-msg-1");
  });
});

describe("applyLocalInboxGmailEnv", () => {
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of GMAIL_ENV) {
      const previous = saved[key];
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
      delete saved[key];
    }
  });

  it("fills dummy HTTPS Gmail URLs and does not rewrite them to http", () => {
    for (const key of GMAIL_ENV) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    applyLocalInboxGmailEnv();
    assert.equal(
      process.env.GMAIL_OAUTH_TOKEN_URL,
      "https://oauth2.googleapis.com/token"
    );
    assert.equal(
      process.env.GMAIL_API_BASE_URL,
      "https://gmail.googleapis.com/gmail/v1"
    );
    assert.ok(process.env.GMAIL_OAUTH_TOKEN_URL?.startsWith("https://"));
    assert.ok(process.env.GMAIL_API_BASE_URL?.startsWith("https://"));
    assert.doesNotThrow(() => assertLocalInboxGmailUrlsAreHttps());
  });

  it("rejects an http GMAIL_API_BASE_URL and an http GMAIL_OAUTH_TOKEN_URL", () => {
    for (const key of GMAIL_ENV) {
      saved[key] = process.env[key];
    }
    process.env.GMAIL_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
    process.env.GMAIL_API_BASE_URL = "http://gmail.googleapis.com/gmail/v1";
    assert.throws(
      () => assertLocalInboxGmailUrlsAreHttps(),
      /GMAIL_OAUTH_TOKEN_URL and GMAIL_API_BASE_URL must be HTTPS/
    );

    process.env.GMAIL_API_BASE_URL = "https://gmail.googleapis.com/gmail/v1";
    process.env.GMAIL_OAUTH_TOKEN_URL = "http://oauth2.googleapis.com/token";
    assert.throws(
      () => assertLocalInboxGmailUrlsAreHttps(),
      /GMAIL_OAUTH_TOKEN_URL and GMAIL_API_BASE_URL must be HTTPS/
    );
  });
});
