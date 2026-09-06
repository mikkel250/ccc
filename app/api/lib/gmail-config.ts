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
const DEFAULT_CV_ATTACHMENT_FILENAME = "CV.docx";
const CV_ATTACHMENT_FILENAME_RE = /^[A-Za-z0-9._-]+$/;
const DEFAULT_HTTP_TIMEOUT_MS = 15_000;
const DEFAULT_AUTH_TIMEOUT_MS = 300_000;

function requireEnv(key: string): string {
  const value = getEnvString(key);
  if (value === undefined) {
    throw new ServiceError(`${key} is not set`);
  }
  return value;
}

export function getGmailClientId(): string {
  return requireEnv("GMAIL_CLIENT_ID");
}

export function getGmailClientSecret(): string {
  return requireEnv("GMAIL_CLIENT_SECRET");
}

export function getGmailRefreshToken(): string {
  return requireEnv("GMAIL_REFRESH_TOKEN");
}

export function getGmailRecruiterLabel(): string {
  return requireEnv("GMAIL_RECRUITER_LABEL");
}

export function getGmailOauthAuthUrl(): string {
  return getEnvString("GMAIL_OAUTH_AUTH_URL", DEFAULT_OAUTH_AUTH_URL)!;
}

export function getGmailOauthTokenUrl(): string {
  return getEnvString("GMAIL_OAUTH_TOKEN_URL", DEFAULT_OAUTH_TOKEN_URL)!;
}

export function getGmailApiBaseUrl(): string {
  return getEnvString("GMAIL_API_BASE_URL", DEFAULT_GMAIL_API_BASE_URL)!;
}

export function getGmailOauthScope(): string {
  return getEnvString("GMAIL_OAUTH_SCOPE", DEFAULT_OAUTH_SCOPE)!;
}

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
  const raw = getEnvString("GMAIL_AUTH_BIND_HOST", DEFAULT_AUTH_BIND_HOST)!;
  if (raw !== "127.0.0.1" && raw !== "::1") {
    throw new ServiceError(
      "GMAIL_AUTH_BIND_HOST must be 127.0.0.1 or ::1"
    );
  }
  return raw;
}

/** Attachment filename for inbox reply drafts. Path separators rejected. */
export function getGmailCvAttachmentFilename(): string {
  const raw = getEnvString(
    "GMAIL_CV_ATTACHMENT_FILENAME",
    DEFAULT_CV_ATTACHMENT_FILENAME
  )!;
  if (raw.includes("..") || !CV_ATTACHMENT_FILENAME_RE.test(raw)) {
    throw new ServiceError("GMAIL_CV_ATTACHMENT_FILENAME is not a valid filename");
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
