import { describe, it, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  completeGmailAuth,
  formatGmailRefreshTokenLine,
  gmailAuthRedirectUri,
  runGmailAuthCli,
} from "../scripts/gmail-auth";
import { formatListedMessageLine, runGmailListCli } from "../scripts/gmail-list";

const KEYS = [
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
  "GMAIL_REFRESH_TOKEN",
  "GMAIL_RECRUITER_LABEL",
  "GMAIL_OAUTH_TOKEN_URL",
  "GMAIL_API_BASE_URL",
] as const;

const saved: Record<string, string | undefined> = {};

describe("gmail-auth CLI helpers", () => {
  it("formats a loopback redirect URI", () => {
    assert.equal(
      gmailAuthRedirectUri("127.0.0.1", 4242),
      "http://127.0.0.1:4242"
    );
    assert.equal(gmailAuthRedirectUri("::1", 4242), "http://[::1]:4242");
  });

  it("prints the refresh token as an env assignment", () => {
    assert.equal(
      formatGmailRefreshTokenLine("tok"),
      "GMAIL_REFRESH_TOKEN=tok"
    );
  });

  it("completes auth from a matching callback", async () => {
    process.env.GMAIL_CLIENT_ID = "client-id";
    process.env.GMAIL_CLIENT_SECRET = "client-secret";
    process.env.GMAIL_OAUTH_TOKEN_URL = "https://oauth.example.test/token";
    const result = await completeGmailAuth({
      callbackUrl: new URL("http://127.0.0.1:9/?code=c&state=st"),
      expectedState: "st",
      redirectUri: "http://127.0.0.1:9",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            access_token: "a",
            refresh_token: "r",
          }),
          { status: 200 }
        ),
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.refreshToken, "r");
    }
  });

  it("fails closed when the auth listener wait exceeds GMAIL_AUTH_TIMEOUT_MS", async () => {
    const previousTimeout = process.env.GMAIL_AUTH_TIMEOUT_MS;
    const previousBind = process.env.GMAIL_AUTH_BIND_HOST;
    process.env.GMAIL_CLIENT_ID = "client-id";
    process.env.GMAIL_CLIENT_SECRET = "client-secret";
    process.env.GMAIL_OAUTH_TOKEN_URL = "https://oauth.example.test/token";
    process.env.GMAIL_AUTH_TIMEOUT_MS = "20";
    process.env.GMAIL_AUTH_BIND_HOST = "127.0.0.1";
    try {
      const result = await runGmailAuthCli({
        listen: async () => ({
          port: 9,
          close: async () => undefined,
          wait: () => new Promise<URL>(() => undefined),
        }),
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.match(result.error, /timed out/i);
      }
    } finally {
      if (previousTimeout === undefined) delete process.env.GMAIL_AUTH_TIMEOUT_MS;
      else process.env.GMAIL_AUTH_TIMEOUT_MS = previousTimeout;
      if (previousBind === undefined) delete process.env.GMAIL_AUTH_BIND_HOST;
      else process.env.GMAIL_AUTH_BIND_HOST = previousBind;
    }
  });

  it("keeps waiting after a stray code callback and accepts the matching state", async () => {
    process.env.GMAIL_CLIENT_ID = "client-id";
    process.env.GMAIL_CLIENT_SECRET = "client-secret";
    process.env.GMAIL_OAUTH_TOKEN_URL = "https://oauth.example.test/token";
    process.env.GMAIL_AUTH_BIND_HOST = "127.0.0.1";
    process.env.GMAIL_AUTH_TIMEOUT_MS = "3000";
    let authorize = "";
    const pending = runGmailAuthCli({
      openUrl: (url) => {
        authorize = url;
      },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ access_token: "a", refresh_token: "r" }),
          { status: 200 }
        ),
    });
    const started = Date.now();
    while (authorize === "" && Date.now() - started < 2000) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const authUrl = new URL(authorize);
    const redirect = authUrl.searchParams.get("redirect_uri");
    const state = authUrl.searchParams.get("state");
    assert.ok(redirect);
    assert.ok(state);
    const stray = await fetch(`${redirect}/?code=nope&state=wrong`);
    assert.equal(stray.status, 400);
    const matched = await fetch(`${redirect}/?code=yes&state=${state}`);
    assert.equal(matched.status, 200);
    const result = await pending;
    assert.equal(result.ok, true);
  });
});

describe("gmail-list CLI", () => {
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

  it("formats one JSON object per message", () => {
    assert.equal(
      formatListedMessageLine({ id: "m1", threadId: "t1" }),
      '{"id":"m1","threadId":"t1"}'
    );
  });

  it("returns ok:false when a required Gmail env var is missing", async () => {
    delete process.env.GMAIL_CLIENT_ID;
    const result = await runGmailListCli({
      fetchImpl: async () => {
        throw new Error("fetch must not run when Gmail env is missing");
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /GMAIL_CLIENT_ID is not set/);
    }
  });

  it("returns list lines from the library", async () => {
    const result = await runGmailListCli({
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/token")) {
          return new Response(JSON.stringify({ access_token: "access" }), {
            status: 200,
          });
        }
        if (url.endsWith("/users/me/labels")) {
          return new Response(
            JSON.stringify({
              labels: [{ id: "Label_1", name: "Recruiter" }],
            }),
            { status: 200 }
          );
        }
        return new Response(
          JSON.stringify({ messages: [{ id: "m1", threadId: "t1" }] }),
          { status: 200 }
        );
      },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.lines, ['{"id":"m1","threadId":"t1"}']);
    }
  });
});
