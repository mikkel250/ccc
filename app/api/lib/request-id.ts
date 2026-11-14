/**
 * Correlation ids for tailor HTTP errors and inbox tailor failures.
 * Inbound X-Request-Id is honored only when it cannot inject into logs.
 */
import { randomUUID } from "node:crypto";

export const REQUEST_ID_HEADER = "x-request-id";
export const REQUEST_ID_MAX_CHARS = 128;

const REQUEST_ID_RE = /^[A-Za-z0-9_-]+$/;

export function generateRequestId(): string {
  return randomUUID();
}

export function resolveRequestId(
  incoming: string | null | undefined
): string {
  if (typeof incoming !== "string") {
    return generateRequestId();
  }
  const trimmed = incoming.trim();
  if (
    trimmed.length >= 1 &&
    trimmed.length <= REQUEST_ID_MAX_CHARS &&
    REQUEST_ID_RE.test(trimmed)
  ) {
    return trimmed;
  }
  return generateRequestId();
}
