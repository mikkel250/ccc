/**
 * Gmail OAuth helpers: authorize URL, callback parse, token exchange/refresh.
 */
import {
  getGmailClientId,
  getGmailClientSecret,
  getGmailHttpTimeoutMs,
  getGmailOauthTokenUrl,
  getGmailRefreshToken,
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

function parseTokenPayload(
  raw: unknown,
  requireRefreshToken: boolean
): GmailOauthResult<GmailTokenSet> {
  if (raw === null || typeof raw !== "object") {
    return { ok: false, error: "Gmail token response was not an object" };
  }
  const accessToken = Reflect.get(raw, "access_token");
  if (typeof accessToken !== "string" || accessToken.trim() === "") {
    return { ok: false, error: "Gmail token response missing access_token" };
  }
  const refreshToken = Reflect.get(raw, "refresh_token");
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
  return parseTokenPayload(parsed, requireRefreshToken);
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

export async function resolveGmailAccessToken(params: {
  fetchImpl?: FetchLike;
  accessToken?: string;
}): Promise<GmailOauthResult<GmailTokenSet>> {
  const provided = params.accessToken?.trim();
  if (provided) {
    return { ok: true, data: { accessToken: provided } };
  }
  return refreshGmailAccessToken({ fetchImpl: params.fetchImpl });
}

export async function refreshGmailAccessToken(params?: {
  fetchImpl?: FetchLike;
  refreshToken?: string;
}): Promise<GmailOauthResult<GmailTokenSet>> {
  const refreshToken = params?.refreshToken ?? getGmailRefreshToken();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: getGmailClientId(),
    client_secret: getGmailClientSecret(),
  });
  return postTokenRequest(
    body,
    params?.fetchImpl ?? fetch,
    getGmailOauthTokenUrl(),
    false
  );
}
