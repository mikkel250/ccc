/**
 * Gmail OAuth helpers: authorize URL, callback parse, token exchange/refresh.
 */
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

export function buildGmailAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  authUrl: string;
}): string {
  const url = new URL(params.authUrl);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", params.scope);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", params.state);
  return url.toString();
}

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

function parseTokenPayload(
  raw: unknown,
  requireRefreshToken: boolean
): GmailOauthResult<GmailTokenSet & { expiresInSeconds?: number }> {
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

async function postTokenRequest(
  body: URLSearchParams,
  fetchImpl: FetchLike,
  tokenUrl: string,
  requireRefreshToken: boolean
): Promise<GmailOauthResult<GmailTokenSet>> {
  let response: Response;
  try {
    response = await fetchImpl(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(getGmailHttpTimeoutMs()),
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
    return { ok: false, error: "Gmail token response was not valid JSON" };
  }
  const token = parseTokenPayload(parsed, requireRefreshToken);
  if (!token.ok) {
    return token;
  }
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

function cacheAccessToken(
  refreshToken: string,
  accessToken: string,
  expiresInSeconds?: number
): void {
  if (expiresInSeconds === undefined) {
    return;
  }
  const safetyMarginMs = getGmailTokenCacheSafetyMarginMs();
  const expiresAtMs =
    Date.now() + Math.max(0, expiresInSeconds * 1000 - safetyMarginMs);
  accessTokenCache.set(refreshToken, { accessToken, expiresAtMs });
}

function readCachedAccessToken(refreshToken: string): string | undefined {
  const cached = accessTokenCache.get(refreshToken);
  if (cached === undefined) {
    return undefined;
  }
  if (Date.now() >= cached.expiresAtMs) {
    accessTokenCache.delete(refreshToken);
    return undefined;
  }
  return cached.accessToken;
}

export async function exchangeGmailAuthCode(
  params: {
    code: string;
    redirectUri: string;
    fetchImpl?: FetchLike;
  }
): Promise<GmailOauthResult<GmailTokenSet>> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    client_id: getGmailClientId(),
    client_secret: getGmailClientSecret(),
    redirect_uri: params.redirectUri,
  });
  return postTokenRequest(
    body,
    params.fetchImpl ?? fetch,
    getGmailOauthTokenUrl(),
    true
  );
}

export async function refreshGmailAccessToken(params?: {
  fetchImpl?: FetchLike;
  refreshToken?: string;
}): Promise<GmailOauthResult<GmailTokenSet>> {
  const refreshToken = params?.refreshToken ?? getGmailRefreshToken();
  const cached = readCachedAccessToken(refreshToken);
  if (cached !== undefined) {
    return { ok: true, data: { accessToken: cached } };
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: getGmailClientId(),
    client_secret: getGmailClientSecret(),
  });
  const fetchImpl = params?.fetchImpl ?? fetch;
  const tokenUrl = getGmailOauthTokenUrl();
  let response: Response;
  try {
    response = await fetchImpl(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(getGmailHttpTimeoutMs()),
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
    return { ok: false, error: "Gmail token response was not valid JSON" };
  }
  const token = parseTokenPayload(parsed, false);
  if (!token.ok) {
    return token;
  }
  cacheAccessToken(
    refreshToken,
    token.data.accessToken,
    token.data.expiresInSeconds
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
