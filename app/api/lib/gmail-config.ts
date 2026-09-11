/**
 * Gmail OAuth and API env. Every tunable originates here (see .env.example).
 */
import { getEnvNumber, getEnvString } from "../../../lib/env";
import { ServiceError } from "./errors";

const DEFAULT_OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const DEFAULT_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_GMAIL_API_BASE_URL = "https://gmail.googleapis.com/gmail/v1";
const DEFAULT_OAUTH_SCOPE =
  "https://www.googleapis.com/auth/gmail.modify";
const DEFAULT_LIST_MAX_RESULTS = 50;
const DEFAULT_LIST_MAX_RESULTS_LIMIT = 500;
const DEFAULT_AUTH_BIND_HOST = "127.0.0.1";
const DEFAULT_HTTP_TIMEOUT_MS = 15_000;
const DEFAULT_AUTH_TIMEOUT_MS = 300_000;

/** Read a required environment variable or name it in a configuration error. */
function requireEnv(key: string): string {
  const value = getEnvString(key);
  if (value === undefined) {
    throw new ServiceError(`${key} is not set`);
  }
  return value;
}

/** Validate an outbound endpoint before credentials can be sent to it. */
function requireHttpsUrl(key: string, fallback: string): string {
  const raw = getEnvString(key, fallback) ?? fallback;
  try {
    if (new URL(raw).protocol === "https:") {
      return raw;
    }
  } catch {
    // Use the same configuration error for invalid and insecure URLs.
  }
  throw new ServiceError(`${key} must be a valid HTTPS URL`);
}

/** Return the OAuth client ID configured for the Gmail integration. */
export function getGmailClientId(): string {
  return requireEnv("GMAIL_CLIENT_ID");
}

/** Return the OAuth client secret configured for the Gmail integration. */
export function getGmailClientSecret(): string {
  return requireEnv("GMAIL_CLIENT_SECRET");
}

/** Return the operator refresh token used for Gmail API access. */
export function getGmailRefreshToken(): string {
  return requireEnv("GMAIL_REFRESH_TOKEN");
}

/** Return the operator-facing label used to select recruiter messages. */
export function getGmailRecruiterLabel(): string {
  return requireEnv("GMAIL_RECRUITER_LABEL");
}

/** Return the authorization endpoint for the Gmail OAuth flow. */
export function getGmailOauthAuthUrl(): string {
  return requireHttpsUrl("GMAIL_OAUTH_AUTH_URL", DEFAULT_OAUTH_AUTH_URL);
}

/** Return the token endpoint for Gmail OAuth exchanges and refreshes. */
export function getGmailOauthTokenUrl(): string {
  return requireHttpsUrl("GMAIL_OAUTH_TOKEN_URL", DEFAULT_OAUTH_TOKEN_URL);
}

/** Return the base URL used for Gmail REST API requests. */
export function getGmailApiBaseUrl(): string {
  return requireHttpsUrl("GMAIL_API_BASE_URL", DEFAULT_GMAIL_API_BASE_URL);
}

/** Return the OAuth scope requested by the local authorization flow. */
export function getGmailOauthScope(): string {
  return getEnvString("GMAIL_OAUTH_SCOPE", DEFAULT_OAUTH_SCOPE) ??
    DEFAULT_OAUTH_SCOPE;
}

/** Return the requested Gmail page size clamped to the configured limit. */
export function getGmailListMaxResults(): number {
  const limit = Math.max(
    1,
    getEnvNumber("GMAIL_LIST_MAX_RESULTS_LIMIT", DEFAULT_LIST_MAX_RESULTS_LIMIT)
  );
  const requested = getEnvNumber(
    "GMAIL_LIST_MAX_RESULTS",
    DEFAULT_LIST_MAX_RESULTS
  );
  return Math.min(limit, Math.max(1, requested));
}

/** Loopback bind host for gmail:auth. Non-loopback values are rejected (R16). */
export function getGmailAuthBindHost(): string {
  const raw =
    getEnvString("GMAIL_AUTH_BIND_HOST", DEFAULT_AUTH_BIND_HOST) ??
    DEFAULT_AUTH_BIND_HOST;
  if (raw !== "127.0.0.1" && raw !== "::1") {
    throw new ServiceError(
      "GMAIL_AUTH_BIND_HOST must be 127.0.0.1 or ::1"
    );
  }
  return raw;
}

/** Abort hung Gmail REST and token POSTs (default 15s). */
export function getGmailHttpTimeoutMs(): number {
  return Math.max(1, getEnvNumber("GMAIL_HTTP_TIMEOUT_MS", DEFAULT_HTTP_TIMEOUT_MS));
}

/** Max wait for the gmail:auth loopback callback (default 5 minutes). */
export function getGmailAuthTimeoutMs(): number {
  return Math.max(1, getEnvNumber("GMAIL_AUTH_TIMEOUT_MS", DEFAULT_AUTH_TIMEOUT_MS));
}
