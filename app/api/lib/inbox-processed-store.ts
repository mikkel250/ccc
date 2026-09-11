/**
 * Redis claim vs processed marks for Gmail messageIds (R10, R12).
 * Claim is SET NX and is not the terminal processed mark.
 * Ownership (processed vs claim) is decided in one Redis EVAL.
 */
import { randomBytes } from "node:crypto";
import {
  getInboxClaimTtlSeconds,
  getInboxMessageIdMaxChars,
  getInboxProcessedTtlSeconds,
  getInboxRedisPrefix,
  getInboxRedisTimeoutMs,
} from "./inbox-config";
import { extractGmailJobDescription } from "./gmail-body";
import { getRedisClient } from "./redis";

export type InboxClaimOutcome = "won" | "lost" | "processed";

export type InboxKv = {
  get: (key: string) => Promise<string | null>;
  set: (
    key: string,
    value: string,
    opts?: { ex?: number }
  ) => Promise<"OK" | null>;
  claimIfUnprocessed: (
    processedKey: string,
    claimKey: string,
    token: string,
    ttlSeconds: number
  ) => Promise<InboxClaimOutcome>;
};

export type ExtractUnprocessedResult =
  | { ok: true; status: "extracted"; jobDescription: string }
  | { ok: true; status: "skipped-processed" }
  | { ok: true; status: "skipped-claimed" }
  | { ok: false; error: string };

const MESSAGE_ID_RE = /^[A-Za-z0-9._-]+$/;

function isInboxRedisTimeout(err: unknown): boolean {
  return err instanceof Error && err.message === "Inbox Redis timed out";
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Inbox Redis timed out"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Atomic claim-vs-processed decision. Keep in sync with applyInboxClaimTransition
 * used by the in-memory test KV.
 *
 * KEYS[1] processed, KEYS[2] claim; ARGV[1] token, ARGV[2] TTL seconds.
 */
const CLAIM_IF_UNPROCESSED_SCRIPT =
  'if redis.call("exists", KEYS[1]) == 1 then ' +
  'if redis.call("get", KEYS[2]) == ARGV[1] then redis.call("del", KEYS[2]) end ' +
  'return "processed" end ' +
  'local existing = redis.call("get", KEYS[2]) ' +
  'if existing == false then ' +
  'redis.call("set", KEYS[2], ARGV[1], "EX", tonumber(ARGV[2])) ' +
  'return "won" end ' +
  'if existing == ARGV[1] then return "won" end ' +
  'return "lost"';

let injectedKv: InboxKv | null = null;

export function __injectInboxKvForTest(kv: InboxKv | null): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("__injectInboxKvForTest is only available in the test environment");
  }
  injectedKv = kv;
}

/** In-memory equivalent of CLAIM_IF_UNPROCESSED_SCRIPT. */
export function applyInboxClaimTransition(
  state: { processed: boolean; claim: string | null },
  token: string
): { outcome: InboxClaimOutcome; claim: string | null } {
  if (state.processed) {
    return {
      outcome: "processed",
      claim: state.claim != null && state.claim !== token ? state.claim : null,
    };
  }
  if (state.claim == null || state.claim === token) {
    return { outcome: "won", claim: token };
  }
  return { outcome: "lost", claim: state.claim };
}

function kv(): InboxKv {
  if (injectedKv) {
    return injectedKv;
  }
  const client = getRedisClient();
  const timeoutMs = getInboxRedisTimeoutMs();
  return {
    get: async (key) => {
      const value = await withTimeout(client.get(key), timeoutMs);
      return typeof value === "string" ? value : value == null ? null : String(value);
    },
    set: async (key, value, opts) => {
      const result =
        opts?.ex !== undefined
          ? await withTimeout(client.set(key, value, { ex: opts.ex }), timeoutMs)
          : await withTimeout(client.set(key, value), timeoutMs);
      return result === "OK" ? "OK" : null;
    },
    claimIfUnprocessed: async (processedKey, claimKey, token, ttlSeconds) => {
      const raw: unknown = await withTimeout(
        client.eval(
          CLAIM_IF_UNPROCESSED_SCRIPT,
          [processedKey, claimKey],
          [token, String(ttlSeconds)]
        ),
        timeoutMs
      );
      if (raw === "won" || raw === "lost" || raw === "processed") {
        return raw;
      }
      throw new Error("Inbox Redis claim returned an unexpected result");
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
  const token = randomBytes(16).toString("hex");
  const processedKey = inboxProcessedKey(parsed.messageId);
  const claimKey = inboxClaimKey(parsed.messageId);
  const ttlSeconds = getInboxClaimTtlSeconds();
  const store = kv();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const outcome = await store.claimIfUnprocessed(
        processedKey,
        claimKey,
        token,
        ttlSeconds
      );
      return { ok: true, outcome };
    } catch (err) {
      if (!isInboxRedisTimeout(err)) {
        throw err;
      }
    }
  }
  return { ok: false, error: "Inbox Redis timed out" };
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
