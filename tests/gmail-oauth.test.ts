import { describe, it, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ServiceError } from "../app/api/lib/errors";
import {
  getGmailAuthBindHost,
  getGmailAuthTimeoutMs,
  getGmailApiBaseUrl,
  getGmailClientId,
  getGmailHttpTimeoutMs,
  getGmailListMaxResults,
  getGmailOauthScope,
  getGmailOauthTokenUrl,
  getGmailRefreshToken,
} from "../app/api/lib/gmail-config";
import {
  buildGmailAuthUrl,
  exchangeGmailAuthCode,
  parseOAuthCallback,
  refreshGmailAccessToken,
  __clearGmailAccessTokenCacheForTest,
} from "../app/api/lib/gmail-oauth";

const KEYS = [
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
  "GMAIL_REFRESH_TOKEN",
  "GMAIL_RECRUITER_LABEL",
  "GMAIL_OAUTH_SCOPE",
  "GMAIL_AUTH_BIND_HOST",
  "GMAIL_LIST_MAX_RESULTS",
  "GMAIL_LIST_MAX_RESULTS_LIMIT",
  "GMAIL_OAUTH_TOKEN_URL",
  "GMAIL_API_BASE_URL",
  "GMAIL_HTTP_TIMEOUT_MS",
  "GMAIL_AUTH_TIMEOUT_MS",
  "GMAIL_TOKEN_CACHE_SAFETY_MARGIN_MS",
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

  it("preserves valid HTTPS Gmail endpoint URLs", () => {
    process.env.GMAIL_OAUTH_TOKEN_URL = "https://oauth.example.test/custom-token";
    process.env.GMAIL_API_BASE_URL = "https://gmail.example.test/custom/v1";
    assert.equal(
      getGmailOauthTokenUrl(),
      "https://oauth.example.test/custom-token"
    );
    assert.equal(
      getGmailApiBaseUrl(),
      "https://gmail.example.test/custom/v1"
    );
  });

  it("preserves the default Gmail endpoint URLs", () => {
    delete process.env.GMAIL_OAUTH_TOKEN_URL;
    delete process.env.GMAIL_API_BASE_URL;
    assert.equal(
      getGmailOauthTokenUrl(),
      "https://oauth2.googleapis.com/token"
    );
    assert.equal(
      getGmailApiBaseUrl(),
      "https://gmail.googleapis.com/gmail/v1"
    );
  });

  it("rejects malformed or non-HTTPS Gmail endpoint URLs", () => {
    for (const value of ["not-a-url", "http://oauth.example.test/token"]) {
      process.env.GMAIL_OAUTH_TOKEN_URL = value;
      assert.throws(() => getGmailOauthTokenUrl(), /GMAIL_OAUTH_TOKEN_URL/);
    }
    for (const value of ["not-a-url", "http://gmail.example.test/gmail/v1"]) {
      process.env.GMAIL_API_BASE_URL = value;
      assert.throws(() => getGmailApiBaseUrl(), /GMAIL_API_BASE_URL/);
    }
  });
});

describe("gmail-oauth", () => {
  beforeEach(() => {
    __clearGmailAccessTokenCacheForTest();
    for (const key of KEYS) {
      saved[key] = process.env[key];
    }
    process.env.GMAIL_CLIENT_ID = "client-id";
    process.env.GMAIL_CLIENT_SECRET = "client-secret";
    process.env.GMAIL_REFRESH_TOKEN = "refresh-token";
    process.env.GMAIL_OAUTH_TOKEN_URL = "https://oauth.example.test/token";
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

  it("builds an offline consent URL with gmail.modify", () => {
    const url = new URL(
      buildGmailAuthUrl({
        clientId: "client-id",
        redirectUri: "http://127.0.0.1:1234",
        scope: "https://www.googleapis.com/auth/gmail.modify",
        state: "abc",
        authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      })
    );
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("prompt"), "consent");
    assert.equal(url.searchParams.get("state"), "abc");
    assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:1234");
    assert.match(
      url.searchParams.get("scope") ?? "",
      /gmail\.modify/
    );
  });

  it("rejects a callback with a mismatched state", () => {
    const url = new URL("http://127.0.0.1:1234/?code=x&state=other");
    const result = parseOAuthCallback(url, "expected");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /state/);
    }
  });

  it("extracts the authorization code when state matches", () => {
    const url = new URL("http://127.0.0.1:1234/?code=the-code&state=s");
    const result = parseOAuthCallback(url, "s");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data, "the-code");
    }
  });

  it("exchanges an auth code and requires refresh_token", async () => {
    const result = await exchangeGmailAuthCode({
      code: "the-code",
      redirectUri: "http://127.0.0.1:1234",
      fetchImpl: async (_input, init) => {
        assert.equal(init?.method, "POST");
        assert.equal(init?.redirect, "error");
        const body = String(init?.body);
        assert.match(body, /grant_type=authorization_code/);
        assert.match(body, /code=the-code/);
        return new Response(
          JSON.stringify({
            access_token: "access",
            refresh_token: "refresh-new",
          }),
          { status: 200 }
        );
      },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.refreshToken, "refresh-new");
    }
  });

  it("fails closed when the auth-code grant omits refresh_token", async () => {
    const result = await exchangeGmailAuthCode({
      code: "the-code",
      redirectUri: "http://127.0.0.1:1234",
      fetchImpl: async () =>
        new Response(JSON.stringify({ access_token: "access" }), {
          status: 200,
        }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /refresh_token/);
    }
  });

  it("refreshes an access token without logging the secret", async () => {
    const result = await refreshGmailAccessToken({
      fetchImpl: async (_input, init) => {
        assert.equal(init?.redirect, "error");
        const body = String(init?.body);
        assert.match(body, /grant_type=refresh_token/);
        assert.match(body, /refresh_token=refresh-token/);
        return new Response(JSON.stringify({ access_token: "new-access" }), {
          status: 200,
        });
      },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.accessToken, "new-access");
    }
  });

  it("maps a token HTTP error without echoing the body", async () => {
    const result = await refreshGmailAccessToken({
      fetchImpl: async () =>
        new Response("secret-leak", { status: 401 }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /HTTP 401/);
      assert.doesNotMatch(result.error, /secret-leak/);
    }
  });

  it("reuses a cached access token until the safety margin before expiry", async () => {
    process.env.GMAIL_TOKEN_CACHE_SAFETY_MARGIN_MS = "1000";
    let tokenPosts = 0;
    const fetchImpl = async () => {
      tokenPosts += 1;
      return new Response(
        JSON.stringify({ access_token: "cached-access", expires_in: 3600 }),
        { status: 200 }
      );
    };
    const first = await refreshGmailAccessToken({ fetchImpl });
    const second = await refreshGmailAccessToken({ fetchImpl });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (first.ok && second.ok) {
      assert.equal(first.data.accessToken, "cached-access");
      assert.equal(second.data.accessToken, "cached-access");
    }
    assert.equal(tokenPosts, 1);
  });

  it("refreshes again once remaining lifetime is within the safety margin", async () => {
    process.env.GMAIL_TOKEN_CACHE_SAFETY_MARGIN_MS = "2000";
    let tokenPosts = 0;
    const fetchImpl = async () => {
      tokenPosts += 1;
      return new Response(
        JSON.stringify({
          access_token: tokenPosts === 1 ? "first-access" : "second-access",
          expires_in: 10,
        }),
        { status: 200 }
      );
    };
    const first = await refreshGmailAccessToken({
      fetchImpl,
      nowMs: 0,
    });
    const stillCached = await refreshGmailAccessToken({
      fetchImpl,
      nowMs: 7_999,
    });
    const afterMargin = await refreshGmailAccessToken({
      fetchImpl,
      nowMs: 8_000,
    });
    assert.equal(first.ok, true);
    assert.equal(stillCached.ok, true);
    assert.equal(afterMargin.ok, true);
    if (first.ok && stillCached.ok && afterMargin.ok) {
      assert.equal(first.data.accessToken, "first-access");
      assert.equal(stillCached.data.accessToken, "first-access");
      assert.equal(afterMargin.data.accessToken, "second-access");
    }
    assert.equal(tokenPosts, 2);
  });

  it("fails closed when the token POST is aborted by the HTTP timeout", async () => {
    process.env.GMAIL_HTTP_TIMEOUT_MS = "20";
    const result = await refreshGmailAccessToken({
      fetchImpl: async (_input, init) => {
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
        return new Response(JSON.stringify({ access_token: "new-access" }), {
          status: 200,
        });
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /token request failed/);
    }
  });
});
