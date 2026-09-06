/**
 * Inbox Redis / message-id tunables. Every value originates in env (.env.example).
 */
import { getEnvNumber, getEnvString } from "../../../lib/env";

const DEFAULT_PREFIX = "inbox";
const DEFAULT_CLAIM_TTL_SECONDS = 900;
const DEFAULT_PROCESSED_TTL_SECONDS = 0;
const DEFAULT_MESSAGE_ID_MAX_CHARS = 128;
const DEFAULT_SCAN_BACKOFF_MS = 1000;
const DEFAULT_REDIS_TIMEOUT_MS = 2000;

export function getInboxRedisPrefix(): string {
  return getEnvString("INBOX_REDIS_PREFIX", DEFAULT_PREFIX)!;
}

export function getInboxClaimTtlSeconds(): number {
  return Math.max(1, getEnvNumber("INBOX_CLAIM_TTL_SECONDS", DEFAULT_CLAIM_TTL_SECONDS));
}

/** 0 = persist with no expiry (terminal processed mark). */
export function getInboxProcessedTtlSeconds(): number {
  return Math.max(0, getEnvNumber("INBOX_PROCESSED_TTL_SECONDS", DEFAULT_PROCESSED_TTL_SECONDS));
}

export function getInboxMessageIdMaxChars(): number {
  return Math.max(1, getEnvNumber("INBOX_MESSAGE_ID_MAX_CHARS", DEFAULT_MESSAGE_ID_MAX_CHARS));
}

/** Milliseconds to wait between scan messages (R9). 0 disables. */
export function getInboxScanBackoffMs(): number {
  return Math.max(0, getEnvNumber("INBOX_SCAN_BACKOFF_MS", DEFAULT_SCAN_BACKOFF_MS));
}

/** Abort hung inbox Redis get/set/del (default 2000ms, same order as rate-limit). */
export function getInboxRedisTimeoutMs(): number {
  return Math.max(1, getEnvNumber("INBOX_REDIS_TIMEOUT_MS", DEFAULT_REDIS_TIMEOUT_MS));
}
