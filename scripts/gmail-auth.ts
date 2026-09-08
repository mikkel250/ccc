/**
 * One-shot local Gmail OAuth CLI (R15). Prints GMAIL_REFRESH_TOKEN for .env.
 *
 * Usage: npm run gmail:auth
 */
import { config as loadDotenv } from "dotenv";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  getGmailAuthBindHost,
  getGmailAuthTimeoutMs,
  getGmailClientId,
  getGmailOauthAuthUrl,
  getGmailOauthScope,
} from "../app/api/lib/gmail-config";
import {
  buildGmailAuthUrl,
  exchangeGmailAuthCode,
  parseOAuthCallback,
} from "../app/api/lib/gmail-oauth";

loadDotenv();

/** Format the loopback origin registered for the local OAuth callback. */
export function gmailAuthRedirectUri(host: string, port: number): string {
  if (host === "::1") {
    return `http://[::1]:${port}`;
  }
  return `http://${host}:${port}`;
}

/** Format a refresh token as the environment assignment shown to the operator. */
export function formatGmailRefreshTokenLine(refreshToken: string): string {
  return `GMAIL_REFRESH_TOKEN=${refreshToken}`;
}

/** Validate the callback and exchange its code for a required refresh token. */
export async function completeGmailAuth(params: {
  callbackUrl: URL;
  expectedState: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; refreshToken: string } | { ok: false; error: string }> {
  const parsed = parseOAuthCallback(params.callbackUrl, params.expectedState);
  if (!parsed.ok) {
    return parsed;
  }
  const tokens = await exchangeGmailAuthCode({
    code: parsed.data,
    redirectUri: params.redirectUri,
    fetchImpl: params.fetchImpl,
  });
  if (!tokens.ok) {
    return { ok: false, error: tokens.error };
  }
  const refreshToken = tokens.data.refreshToken;
  if (refreshToken === undefined) {
    return { ok: false, error: "Gmail token response missing refresh_token" };
  }
  return { ok: true, refreshToken };
}

/** Parse an incoming loopback request against the listener origin. */
function requestUrl(req: IncomingMessage, host: string, port: number): URL {
  return new URL(req.url ?? "/", gmailAuthRedirectUri(host, port));
}

/** Run the one-shot local OAuth flow and print the resulting refresh token. */
export async function runGmailAuthCli(params?: {
  fetchImpl?: typeof fetch;
  openUrl?: (url: string) => void;
  listen?: (host: string) => Promise<{ port: number; close: () => Promise<void>; wait: () => Promise<URL> }>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const host = getGmailAuthBindHost();
  const clientId = getGmailClientId();
  const scope = getGmailOauthScope();
  const authUrlBase = getGmailOauthAuthUrl();
  const state = randomBytes(16).toString("hex");

  const waiter =
    params?.listen ??
    (async (bindHost: string) => {
      const server = createServer();
      await new Promise<void>((resolve) => {
        server.listen(0, bindHost, () => resolve());
      });
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        throw new Error("Gmail auth listener failed to bind");
      }
      let settle: (url: URL) => void;
      const wait = new Promise<URL>((resolveWait) => {
        settle = resolveWait;
      });
      server.on("request", (req: IncomingMessage, res: ServerResponse) => {
        const url = requestUrl(req, bindHost, address.port);
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("You can close this tab and return to the terminal.");
        settle(url);
      });
      return {
        port: address.port,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((err) => (err ? rejectClose(err) : resolveClose()));
          }),
        wait: () => wait,
      };
    });

  const listener = await waiter(host);
  const redirectUri = gmailAuthRedirectUri(host, listener.port);
  const authorizeUrl = buildGmailAuthUrl({
    clientId,
    redirectUri,
    scope,
    state,
    authUrl: authUrlBase,
  });
  console.log("Open this URL to authorize Gmail:");
  console.log(authorizeUrl);
  params?.openUrl?.(authorizeUrl);

  let callbackUrl: URL;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    callbackUrl = await Promise.race([
      listener.wait(),
      new Promise<URL>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Gmail auth timed out waiting for the OAuth callback"));
        }, getGmailAuthTimeoutMs());
      }),
    ]);
  } catch (error: unknown) {
    await listener.close().catch(() => undefined);
    const message =
      error instanceof Error ? error.message : "Gmail auth timed out";
    console.error(message);
    return { ok: false, error: message };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  const result = await completeGmailAuth({
    callbackUrl,
    expectedState: state,
    redirectUri,
    fetchImpl: params?.fetchImpl,
  });
  await listener.close();
  if (!result.ok) {
    console.error(result.error);
    return result;
  }
  console.log("Paste this into .env / Railway (do not commit it):");
  console.log(formatGmailRefreshTokenLine(result.refreshToken));
  return { ok: true };
}

/** Execute the Gmail authorization CLI and map failure to its process exit code. */
async function main(): Promise<void> {
  const result = await runGmailAuthCli();
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
