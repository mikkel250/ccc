import { describe, it, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ServiceError } from "../app/api/lib/errors";
import {
  getGmailAuthBindHost,
  getGmailApiBaseUrl,
  getGmailAuthTimeoutMs,
  getGmailClientId,
  getGmailHttpTimeoutMs,
  getGmailListMaxResults,
  getGmailOauthAuthUrl,
  getGmailOauthScope,
  getGmailOauthTokenUrl,
  getGmailRefreshToken,
} from "../app/api/lib/gmail-config";

const KEYS = [
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
  "GMAIL_REFRESH_TOKEN",
  "GMAIL_RECRUITER_LABEL",
  "GMAIL_OAUTH_SCOPE",
  "GMAIL_AUTH_BIND_HOST",
  "GMAIL_LIST_MAX_RESULTS",
  "GMAIL_LIST_MAX_RESULTS_LIMIT",
  "GMAIL_OAUTH_AUTH_URL",
  "GMAIL_OAUTH_TOKEN_URL",
  "GMAIL_API_BASE_URL",
  "GMAIL_HTTP_TIMEOUT_MS",
  "GMAIL_AUTH_TIMEOUT_MS",
] as const;

const saved: Record<string, string | undefined> = {};

describe("gmail-config", () => {
  beforeEach(() => {
    for (const key of KEYS) {
      saved[key] = process.env[key];
    }
    process.env.GMAIL_CLIENT_ID = "client-id";
    process.env.GMAIL_CLIENT_SECRET = "client-secret";
    process.env.GMAIL_REFRESH_TOKEN = "refresh-token";
    process.env.GMAIL_RECRUITER_LABEL = "Recruiter";
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

  it("throws ServiceError naming the key when GMAIL_CLIENT_ID is missing", () => {
    delete process.env.GMAIL_CLIENT_ID;
    assert.throws(() => getGmailClientId(), ServiceError);
    assert.throws(() => getGmailClientId(), /GMAIL_CLIENT_ID/);
  });

  it("throws ServiceError naming the key when GMAIL_REFRESH_TOKEN is missing", () => {
    delete process.env.GMAIL_REFRESH_TOKEN;
    assert.throws(() => getGmailRefreshToken(), /GMAIL_REFRESH_TOKEN/);
  });

  it("defaults OAuth scope to gmail.modify", () => {
    delete process.env.GMAIL_OAUTH_SCOPE;
    assert.equal(
      getGmailOauthScope(),
      "https://www.googleapis.com/auth/gmail.modify"
    );
  });

  it("preserves the default HTTPS Gmail endpoint URLs", () => {
    delete process.env.GMAIL_OAUTH_AUTH_URL;
    delete process.env.GMAIL_OAUTH_TOKEN_URL;
    delete process.env.GMAIL_API_BASE_URL;
    assert.equal(
      getGmailOauthAuthUrl(),
      "https://accounts.google.com/o/oauth2/v2/auth"
    );
    assert.equal(
      getGmailOauthTokenUrl(),
      "https://oauth2.googleapis.com/token"
    );
    assert.equal(
      getGmailApiBaseUrl(),
      "https://gmail.googleapis.com/gmail/v1"
    );
  });

  it("rejects non-HTTPS and invalid Gmail endpoint URLs", () => {
    process.env.GMAIL_OAUTH_AUTH_URL = "http://accounts.example.test/auth";
    assert.throws(() => getGmailOauthAuthUrl(), /GMAIL_OAUTH_AUTH_URL.*HTTPS/);

    process.env.GMAIL_OAUTH_TOKEN_URL = "http://oauth.example.test/token";
    assert.throws(() => getGmailOauthTokenUrl(), /GMAIL_OAUTH_TOKEN_URL.*HTTPS/);

    process.env.GMAIL_API_BASE_URL = "not a URL";
    assert.throws(() => getGmailApiBaseUrl(), /GMAIL_API_BASE_URL.*HTTPS/);
  });

  it("rejects a non-loopback GMAIL_AUTH_BIND_HOST", () => {
    process.env.GMAIL_AUTH_BIND_HOST = "0.0.0.0";
    assert.throws(() => getGmailAuthBindHost(), /127\.0\.0\.1/);
  });

  it("caps list maxResults at the configured limit", () => {
    process.env.GMAIL_LIST_MAX_RESULTS = "9999";
    process.env.GMAIL_LIST_MAX_RESULTS_LIMIT = "100";
    assert.equal(getGmailListMaxResults(), 100);
  });

  it("reads GMAIL_HTTP_TIMEOUT_MS and GMAIL_AUTH_TIMEOUT_MS from env", () => {
    process.env.GMAIL_HTTP_TIMEOUT_MS = "1234";
    process.env.GMAIL_AUTH_TIMEOUT_MS = "5678";
    assert.equal(getGmailHttpTimeoutMs(), 1234);
    assert.equal(getGmailAuthTimeoutMs(), 5678);
  });
});
