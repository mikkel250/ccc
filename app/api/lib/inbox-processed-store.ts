/**
 * Redis claim vs processed marks for Gmail messageIds (R10, R12).
 * Claim is SET NX and is not the terminal processed mark.
 */
import {
  getInboxClaimTtlSeconds,
  getInboxMessageIdMaxChars,
  getInboxProcessedTtlSeconds,
  getInboxRedisPrefix,
} from "./inbox-config";
import { extractGmailJobDescription } from "./gmail-body";
import { getRedisClient } from "./redis";

export type InboxKv = {
  get: (key: string) => Promise<string | null>;
  set: (
    key: string,
    value: string,
    opts?: { nx?: boolean; ex?: number }
  ) => Promise<"OK" | null>;
};

export type InboxClaimOutcome = "won" | "lost" | "processed";

export type ExtractUnprocessedResult =
  | { ok: true; status: "extracted"; jobDescription: string }
  | { ok: true; status: "skipped-processed" }
  | { ok: true; status: "skipped-claimed" }
  | { ok: false; error: string };

const MESSAGE_ID_RE = /^[A-Za-z0-9._-]+$/;

let injectedKv: InboxKv | null = null;

export function __injectInboxKvForTest(kv: InboxKv | null): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("__injectInboxKvForTest is only available in the test environment");
  }
  injectedKv = kv;
}

function kv(): InboxKv {
  if (injectedKv) {
    return injectedKv;
  }
  const client = getRedisClient();
  return {
    get: async (key) => {
      const value = await client.get(key);
      return typeof value === "string" ? value : value == null ? null : String(value);
    },
    set: async (key, value, opts) => {
      let result: unknown;
      if (opts?.nx === true) {
        result = await client.set(key, value, {
          nx: true,
          ex: opts.ex ?? getInboxClaimTtlSeconds(),
        });
      } else if (opts?.ex !== undefined) {
        result = await client.set(key, value, { ex: opts.ex });
      } else {
        result = await client.set(key, value);
      }
      return result === "OK" ? "OK" : null;
    },
  };
}

export function inboxClaimKey(messageId: string): string {
  return `${getInboxRedisPrefix()}:claim:${messageId}`;
}

export function inboxProcessedKey(messageId: string): string {
  return `${getInboxRedisPrefix()}:processed:${messageId}`;
}

export function parseInboxMessageId(
  value: unknown
): { ok: true; messageId: string } | { ok: false; error: string } {
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, error: "Gmail messageId is required" };
  }
  const messageId = value.trim();
  if (messageId.length > getInboxMessageIdMaxChars()) {
    return { ok: false, error: "Gmail messageId exceeds configured max length" };
  }
  if (!MESSAGE_ID_RE.test(messageId)) {
    return { ok: false, error: "Gmail messageId contains unsupported characters" };
  }
  return { ok: true, messageId };
}

export async function isInboxProcessed(messageId: string): Promise<boolean> {
  const parsed = parseInboxMessageId(messageId);
  if (!parsed.ok) {
    return false;
  }
  const value = await kv().get(inboxProcessedKey(parsed.messageId));
  return value != null;
}

export async function claimInboxMessage(
  messageId: string
): Promise<{ ok: true; outcome: InboxClaimOutcome } | { ok: false; error: string }> {
  const parsed = parseInboxMessageId(messageId);
  if (!parsed.ok) {
    return parsed;
  }
  if (await isInboxProcessed(parsed.messageId)) {
    return { ok: true, outcome: "processed" };
  }
  const set = await kv().set(inboxClaimKey(parsed.messageId), "1", {
    nx: true,
    ex: getInboxClaimTtlSeconds(),
  });
  if (set === "OK") {
    return { ok: true, outcome: "won" };
  }
  if (await isInboxProcessed(parsed.messageId)) {
    return { ok: true, outcome: "processed" };
  }
  return { ok: true, outcome: "lost" };
}

export async function markInboxProcessed(
  messageId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = parseInboxMessageId(messageId);
  if (!parsed.ok) {
    return parsed;
  }
  const ttl = getInboxProcessedTtlSeconds();
  const opts = ttl > 0 ? { ex: ttl } : undefined;
  const set = await kv().set(inboxProcessedKey(parsed.messageId), "1", opts);
  if (set !== "OK") {
    return { ok: false, error: "Failed to persist processed messageId" };
  }
  return { ok: true };
}

export async function extractUnprocessedInboxMessage(
  messageId: string,
  message: unknown
): Promise<ExtractUnprocessedResult> {
  const claimed = await claimInboxMessage(messageId);
  if (!claimed.ok) {
    return claimed;
  }
  if (claimed.outcome === "processed") {
    return { ok: true, status: "skipped-processed" };
  }
  if (claimed.outcome === "lost") {
    return { ok: true, status: "skipped-claimed" };
  }
  const extracted = extractGmailJobDescription(message);
  if (!extracted.ok) {
    return extracted;
  }
  return {
    ok: true,
    status: "extracted",
    jobDescription: extracted.jobDescription,
  };
}
