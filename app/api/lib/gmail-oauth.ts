/**
 * Gmail OAuth helpers: authorize URL, callback parse, token exchange/refresh.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  getGmailClientId,
  getGmailClientSecret,
  getGmailHttpTimeoutMs,
  getGmailOauthTokenUrl,
  getGmailRefreshToken,
  getGmailTokenCacheSafetyMarginMs,
} from "./gmail-config";

export type FetchLike = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

/**
 * Referenced abort timer. AbortSignal.timeout() is unref'd, so a hung fetch
 * that is the only pending work never fires the deadline.
 */
export function gmailAbortAfter(timeoutMs: number): {
  signal: AbortSignal;
  cancel: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}

export type GmailTokenSet = {
  accessToken: string;
  refreshToken?: string;
};

export type GmailOauthResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

type CachedAccessToken = {
  accessToken: string;
  expiresAtMs: number;
};

const accessTokenCache = new Map<string, CachedAccessToken>();

export function __clearGmailAccessTokenCacheForTest(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "__clearGmailAccessTokenCacheForTest is only available in the test environment"
    );
  }
  accessTokenCache.clear();
}

export type GmailPkcePair = {
  codeVerifier: string;
  codeChallenge: string;
};

/** One PKCE verifier/challenge pair per desktop OAuth attempt (S256). */
export function generateGmailPkcePair(): GmailPkcePair {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return { codeVerifier, codeChallenge };
}

/** Build the state-protected Google OAuth URL for offline Gmail consent. */
export function buildGmailAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  authUrl: string;
  codeChallenge: string;
}): string {
  const url = new URL(params.authUrl);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", params.scope);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/** Validate an OAuth callback and extract its authorization code. */
export function parseOAuthCallback(
  callbackUrl: URL,
  expectedState: string
): GmailOauthResult<string> {
  const err = callbackUrl.searchParams.get("error");
  if (err != null && err.length > 0) {
    return { ok: false, error: "Gmail OAuth authorization failed" };
  }
  const state = callbackUrl.searchParams.get("state");
  if (state !== expectedState) {
    return { ok: false, error: "Gmail OAuth state mismatch" };
  }
  const code = callbackUrl.searchParams.get("code");
  if (code == null || code.trim() === "") {
    return { ok: false, error: "Gmail OAuth missing authorization code" };
  }
  return { ok: true, data: code };
}

function parseExpiresIn(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

type ParsedGmailToken = GmailTokenSet & { expiresInSeconds?: number };

/** Validate the token fields returned by the OAuth token endpoint. */
function parseTokenPayload(
  raw: unknown,
  requireRefreshToken: boolean
): GmailOauthResult<ParsedGmailToken> {
  if (raw === null || typeof raw !== "object") {
    return { ok: false, error: "Gmail token response was not an object" };
  }
  const accessToken = Reflect.get(raw, "access_token");
  if (typeof accessToken !== "string" || accessToken.trim() === "") {
    return { ok: false, error: "Gmail token response missing access_token" };
  }
  const refreshToken = Reflect.get(raw, "refresh_token");
  const expiresInSeconds = parseExpiresIn(Reflect.get(raw, "expires_in"));
  if (requireRefreshToken) {
    if (typeof refreshToken !== "string" || refreshToken.trim() === "") {
      return {
        ok: false,
        error: "Gmail token response missing refresh_token",
      };
    }
    return {
      ok: true,
      data: {
        accessToken: accessToken.trim(),
        refreshToken: refreshToken.trim(),
        ...(expiresInSeconds !== undefined ? { expiresInSeconds } : {}),
      },
    };
  }
  return {
    ok: true,
    data: {
      accessToken: accessToken.trim(),
      ...(typeof refreshToken === "string" && refreshToken.trim() !== ""
        ? { refreshToken: refreshToken.trim() }
        : {}),
      ...(expiresInSeconds !== undefined ? { expiresInSeconds } : {}),
    },
  };
}

/** Post a token grant and normalize transport, HTTP, and payload failures. */
async function postTokenRequest(
  body: URLSearchParams,
  fetchImpl: FetchLike,
  tokenUrl: string,
  requireRefreshToken: boolean
): Promise<GmailOauthResult<ParsedGmailToken>> {
  const deadline = gmailAbortAfter(getGmailHttpTimeoutMs());
  try {
    let response: Response;
    try {
      response = await fetchImpl(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        redirect: "error",
        signal: deadline.signal,
      });
    } catch {
      return { ok: false, error: "Gmail token request failed" };
    }
    if (!response.ok) {
      return { ok: false, error: `Gmail token HTTP ${response.status}` };
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      if (deadline.signal.aborted) {
        return { ok: false, error: "Gmail token request failed" };
      }
      return { ok: false, error: "Gmail token response was not valid JSON" };
    }
    return parseTokenPayload(parsed, requireRefreshToken);
  } finally {
    deadline.cancel();
  }
}

function cacheAccessToken(
  refreshToken: string,
  accessToken: string,
  expiresInSeconds: number | undefined,
  nowMs: number
): void {
  if (expiresInSeconds === undefined) {
    return;
  }
  const safetyMarginMs = getGmailTokenCacheSafetyMarginMs();
  const expiresAtMs =
    nowMs + Math.max(0, expiresInSeconds * 1000 - safetyMarginMs);
  accessTokenCache.set(refreshToken, { accessToken, expiresAtMs });
}

function readCachedAccessToken(
  refreshToken: string,
  nowMs: number
): string | undefined {
  const cached = accessTokenCache.get(refreshToken);
  if (cached === undefined) {
    return undefined;
  }
  if (nowMs >= cached.expiresAtMs) {
    accessTokenCache.delete(refreshToken);
    return undefined;
  }
  return cached.accessToken;
}

/** Exchange a Gmail authorization code for access and refresh tokens. */
export async function exchangeGmailAuthCode(
  params: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
    fetchImpl?: FetchLike;
  }
): Promise<GmailOauthResult<GmailTokenSet>> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    client_id: getGmailClientId(),
    client_secret: getGmailClientSecret(),
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });
  return postTokenRequest(
    body,
    params.fetchImpl ?? fetch,
    getGmailOauthTokenUrl(),
    true
  );
}

/** Refresh the short-lived Gmail access token used by REST requests. */
export async function refreshGmailAccessToken(params?: {
  fetchImpl?: FetchLike;
  refreshToken?: string;
  nowMs?: number;
}): Promise<GmailOauthResult<GmailTokenSet>> {
  const refreshToken = params?.refreshToken ?? getGmailRefreshToken();
  const nowMs = params?.nowMs ?? Date.now();
  const cached = readCachedAccessToken(refreshToken, nowMs);
  if (cached !== undefined) {
    return { ok: true, data: { accessToken: cached } };
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: getGmailClientId(),
    client_secret: getGmailClientSecret(),
  });
  const token = await postTokenRequest(
    body,
    params?.fetchImpl ?? fetch,
    getGmailOauthTokenUrl(),
    false
  );
  if (!token.ok) {
    return token;
  }
  cacheAccessToken(
    refreshToken,
    token.data.accessToken,
    token.data.expiresInSeconds,
    nowMs
  );
  return {
    ok: true,
    data: {
      accessToken: token.data.accessToken,
      ...(token.data.refreshToken !== undefined
        ? { refreshToken: token.data.refreshToken }
        : {}),
    },
  };
}
