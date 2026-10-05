/**
 * One-shot local Gmail OAuth CLI (R15). Prints or writes GMAIL_REFRESH_TOKEN.
 *
 * Usage: npm run gmail:auth
 */
import { config as loadDotenv } from "dotenv";
import { chmodSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  getGmailAuthBindHost,
  getGmailAuthTimeoutMs,
  getGmailClientId,
  getGmailOauthAuthUrl,
  getGmailOauthScope,
  getGmailRefreshTokenOutputPath,
} from "../app/api/lib/gmail-config";
import {
  buildGmailAuthUrl,
  exchangeGmailAuthCode,
  generateGmailPkcePair,
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

/** Write the refresh token to a mode-0600 file at an operator-chosen path. */
export function writeGmailRefreshTokenFile(
  refreshToken: string,
  filePath: string
): string {
  writeFileSync(filePath, `${formatGmailRefreshTokenLine(refreshToken)}\n`, {
    mode: 0o600,
  });
  chmodSync(filePath, 0o600);
  return filePath;
}

/** Validate the callback and exchange its code for a required refresh token. */
export async function completeGmailAuth(params: {
  callbackUrl: URL;
  expectedState: string;
  redirectUri: string;
  codeVerifier: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; refreshToken: string } | { ok: false; error: string }> {
  const parsed = parseOAuthCallback(params.callbackUrl, params.expectedState);
  if (!parsed.ok) {
    return parsed;
  }
  const tokens = await exchangeGmailAuthCode({
    code: parsed.data,
    redirectUri: params.redirectUri,
    codeVerifier: params.codeVerifier,
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

/** True when the loopback request is an OAuth redirect, not a probe or favicon. */
export function isGmailOauthLoopbackCallback(url: URL): boolean {
  return url.searchParams.has("code") || url.searchParams.has("error");
}

/** True when this redirect belongs to the in-flight attempt, not a stray hit. */
export function isGmailOauthCallbackForState(
  url: URL,
  expectedState: string
): boolean {
  return (
    isGmailOauthLoopbackCallback(url) &&
    url.searchParams.get("state") === expectedState
  );
}

type GmailAuthListener = {
  port: number;
  close: () => Promise<void>;
  wait: () => Promise<URL>;
};

/** Run the one-shot local OAuth flow and print or write the refresh token. */
export async function runGmailAuthCli(params?: {
  fetchImpl?: typeof fetch;
  openUrl?: (url: string) => void;
  listen?: (host: string) => Promise<GmailAuthListener>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  let listener: GmailAuthListener | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const host = getGmailAuthBindHost();
    const clientId = getGmailClientId();
    const scope = getGmailOauthScope();
    const authUrlBase = getGmailOauthAuthUrl();
    const state = randomBytes(16).toString("hex");
    const { codeVerifier, codeChallenge } = generateGmailPkcePair();

    const waiter =
      params?.listen ??
      (async (bindHost: string) => {
        const server = createServer();
        await new Promise<void>((resolve, reject) => {
          const rejectStartup = (error: Error) => reject(error);
          server.once("error", rejectStartup);
          server.listen(0, bindHost, () => {
            server.off("error", rejectStartup);
            resolve();
          });
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
          if (!isGmailOauthCallbackForState(url, state)) {
            res.statusCode = isGmailOauthLoopbackCallback(url) ? 400 : 204;
            res.end();
            return;
          }
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

    listener = await waiter(host);
    const redirectUri = gmailAuthRedirectUri(host, listener.port);
    const authorizeUrl = buildGmailAuthUrl({
      clientId,
      redirectUri,
      scope,
      state,
      authUrl: authUrlBase,
      codeChallenge,
    });
    console.log("Open this URL to authorize Gmail:");
    console.log(authorizeUrl);
    params?.openUrl?.(authorizeUrl);

    const callbackUrl = await Promise.race([
      listener.wait(),
      new Promise<URL>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Gmail auth timed out waiting for the OAuth callback"));
        }, getGmailAuthTimeoutMs());
      }),
    ]);

    const result = await completeGmailAuth({
      callbackUrl,
      expectedState: state,
      redirectUri,
      codeVerifier,
      fetchImpl: params?.fetchImpl,
    });
    if (!result.ok) {
      console.error(result.error);
      return result;
    }
    const outputPath = getGmailRefreshTokenOutputPath();
    if (outputPath !== undefined) {
      writeGmailRefreshTokenFile(result.refreshToken, outputPath);
      console.log("Wrote refresh token (mode 0600; do not commit):");
      console.log(outputPath);
    } else {
      console.log("Add this to .env / Railway (do not commit):");
      console.log(formatGmailRefreshTokenLine(result.refreshToken));
    }
    return { ok: true };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Gmail auth timed out";
    console.error(message);
    return { ok: false, error: message };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    await listener?.close().catch(() => undefined);
  }
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
