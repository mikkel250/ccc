/**
 * Redis claim vs processed marks for Gmail messageIds (R10, R12).
 * Claim is SET NX and is not the terminal processed mark.
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

export type InboxKv = {
  get: (key: string) => Promise<string | null>;
  set: (
    key: string,
    value: string,
    opts?: { nx?: boolean; ex?: number }
  ) => Promise<"OK" | null>;
  deleteIfValue: (key: string, value: string) => Promise<boolean>;
  expireIfOwned: (
    key: string,
    value: string,
    ttlSeconds: number
  ) => Promise<boolean>;
  markProcessedIfOwned: (
    claimKey: string,
    processedKey: string,
    token: string,
    ttlSeconds: number
  ) => Promise<boolean>;
};

export type InboxClaimOutcome = "won" | "lost" | "processed";

export type InboxClaimResult =
  | { ok: true; outcome: "won"; token: string }
  | { ok: true; outcome: "lost" }
  | { ok: true; outcome: "processed" }
  | { ok: false; error: string };

export type ExtractUnprocessedResult =
  | { ok: true; status: "extracted"; jobDescription: string; claimToken: string }
  | { ok: true; status: "skipped-processed" }
  | { ok: true; status: "skipped-claimed" }
  | { ok: false; error: string };

export const INBOX_REDIS_TIMEOUT_ERROR = "Inbox Redis timed out";
export const INBOX_REDIS_UNAVAILABLE_ERROR = "Inbox Redis unavailable";
export const INBOX_CLAIM_TOKEN_REQUIRED_ERROR = "Inbox claim token is required";
export const INBOX_CLAIM_LOST_ERROR = "Inbox claim is no longer owned";

const MESSAGE_ID_RE = /^[A-Za-z0-9._-]+$/;
const DELETE_IF_VALUE_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';
const EXPIRE_IF_OWNED_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("expire", KEYS[1], tonumber(ARGV[2])) else return 0 end';
const MARK_PROCESSED_IF_OWNED_SCRIPT = `
local current = redis.call("get", KEYS[1])
if current ~= ARGV[1] then
  return 0
end
if tonumber(ARGV[2]) > 0 then
  redis.call("set", KEYS[2], "1", "EX", ARGV[2])
else
  redis.call("set", KEYS[2], "1")
end
redis.call("del", KEYS[1])
return 1
`;

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
  const timeoutMs = getInboxRedisTimeoutMs();
  return {
    get: async (key) => {
      const value = await withTimeout(client.get(key), timeoutMs);
      return typeof value === "string" ? value : value == null ? null : String(value);
    },
    set: async (key, value, opts) => {
      let result: unknown;
      if (opts?.nx === true) {
        result = await withTimeout(
          client.set(key, value, {
            nx: true,
            ex: opts.ex ?? getInboxClaimTtlSeconds(),
          }),
          timeoutMs
        );
      } else if (opts?.ex !== undefined) {
        result = await withTimeout(
          client.set(key, value, { ex: opts.ex }),
          timeoutMs
        );
      } else {
        result = await withTimeout(client.set(key, value), timeoutMs);
      }
      return result === "OK" ? "OK" : null;
    },
    deleteIfValue: async (key, value) => {
      const deleted = await withTimeout(
        client.eval<[string], number>(DELETE_IF_VALUE_SCRIPT, [key], [value]),
        timeoutMs
      );
      return deleted === 1;
    },
    expireIfOwned: async (key, value, ttlSeconds) => {
      const renewed = await withTimeout(
        client.eval(EXPIRE_IF_OWNED_SCRIPT, [key], [value, String(ttlSeconds)]),
        timeoutMs
      );
      return renewed === 1;
    },
    markProcessedIfOwned: async (claimKey, processedKey, token, ttlSeconds) => {
      const marked = await withTimeout(
        client.eval<[string, string], number>(
          MARK_PROCESSED_IF_OWNED_SCRIPT,
          [claimKey, processedKey],
          [token, String(ttlSeconds)]
        ),
        timeoutMs
      );
      return marked === 1;
    },
  };
}

function isInboxRedisTimeout(err: unknown): boolean {
  return err instanceof Error && err.message === INBOX_REDIS_TIMEOUT_ERROR;
}

function inboxRedisFailure(err: unknown): { ok: false; error: string } {
  if (isInboxRedisTimeout(err)) {
    return { ok: false, error: INBOX_REDIS_TIMEOUT_ERROR };
  }
  if (err instanceof Error) {
    return { ok: false, error: INBOX_REDIS_UNAVAILABLE_ERROR };
  }
  throw err;
}

async function callKv<T>(
  op: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await op() };
  } catch (err) {
    return inboxRedisFailure(err);
  }
}

/**
 * Client-side deadline only — does not cancel the Upstash REST request (@upstash/redis
 * has no AbortSignal). A late response may still mutate Redis after we reject.
 * Callers reconcile: claim SET timeouts GET the key (token match → won; empty → 503);
 * token-gated delete/expire/markProcessed ignore stale callers. Orphan claims expire
 * via INBOX_CLAIM_TTL_SECONDS. See docs/solutions/upstash-redis-inbox-timeout-race.md.
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(INBOX_REDIS_TIMEOUT_ERROR));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
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

export async function isInboxProcessed(
  messageId: string
): Promise<{ ok: true; processed: boolean } | { ok: false; error: string }> {
  const parsed = parseInboxMessageId(messageId);
  if (!parsed.ok) {
    return { ok: true, processed: false };
  }
  const got = await callKv(() => kv().get(inboxProcessedKey(parsed.messageId)));
  if (!got.ok) {
    return got;
  }
  return { ok: true, processed: got.value != null };
}

export async function claimInboxMessage(
  messageId: string
): Promise<InboxClaimResult> {
  const parsed = parseInboxMessageId(messageId);
  if (!parsed.ok) {
    return parsed;
  }
  const already = await isInboxProcessed(parsed.messageId);
  if (!already.ok) {
    return already;
  }
  if (already.processed) {
    return { ok: true, outcome: "processed" };
  }
  const token = randomBytes(16).toString("hex");
  const claimKey = inboxClaimKey(parsed.messageId);
  const store = kv();
  let set: "OK" | null = null;
  let setTimedOut = false;
  try {
    set = await store.set(claimKey, token, {
      nx: true,
      ex: getInboxClaimTtlSeconds(),
    });
  } catch (err) {
    if (!isInboxRedisTimeout(err)) {
      return inboxRedisFailure(err);
    }
    setTimedOut = true;
  }
  let claimed = set === "OK";
  if (!claimed) {
    const existing = await callKv(() => store.get(claimKey));
    if (!existing.ok) {
      return existing;
    }
    if (existing.value === token) {
      claimed = true;
    } else if (existing.value != null) {
      return { ok: true, outcome: "lost" };
    } else if (setTimedOut) {
      return { ok: false, error: INBOX_REDIS_TIMEOUT_ERROR };
    }
  }
  if (claimed) {
    const processed = await isInboxProcessed(parsed.messageId);
    if (!processed.ok) {
      return processed;
    }
    const currentClaim = await callKv(() => store.get(claimKey));
    if (!currentClaim.ok) {
      return currentClaim;
    }
    if (processed.processed) {
      if (currentClaim.value === token) {
        const released = await callKv(() => store.deleteIfValue(claimKey, token));
        if (!released.ok) {
          return released;
        }
      }
      return { ok: true, outcome: "processed" };
    }
    if (currentClaim.value === token) {
      return { ok: true, outcome: "won", token };
    }
    return { ok: true, outcome: "lost" };
  }
  const lateProcessed = await isInboxProcessed(parsed.messageId);
  if (!lateProcessed.ok) {
    return lateProcessed;
  }
  if (lateProcessed.processed) {
    return { ok: true, outcome: "processed" };
  }
  return { ok: true, outcome: "lost" };
}

export async function releaseInboxClaim(
  messageId: string,
  claimToken: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = parseInboxMessageId(messageId);
  if (!parsed.ok) {
    return parsed;
  }
  if (typeof claimToken !== "string" || claimToken === "") {
    return { ok: false, error: INBOX_CLAIM_TOKEN_REQUIRED_ERROR };
  }
  const released = await callKv(() =>
    kv().deleteIfValue(inboxClaimKey(parsed.messageId), claimToken)
  );
  if (!released.ok) {
    return released;
  }
  return { ok: true };
}

export async function renewInboxClaim(
  messageId: string,
  claimToken: string
): Promise<{ ok: true; renewed: boolean } | { ok: false; error: string }> {
  const parsed = parseInboxMessageId(messageId);
  if (!parsed.ok) {
    return parsed;
  }
  if (typeof claimToken !== "string" || claimToken === "") {
    return { ok: false, error: INBOX_CLAIM_TOKEN_REQUIRED_ERROR };
  }
  const renewed = await callKv(() =>
    kv().expireIfOwned(
      inboxClaimKey(parsed.messageId),
      claimToken,
      getInboxClaimTtlSeconds()
    )
  );
  if (!renewed.ok) {
    return renewed;
  }
  return { ok: true, renewed: renewed.value };
}

export async function markInboxProcessed(
  messageId: string,
  claimToken: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = parseInboxMessageId(messageId);
  if (!parsed.ok) {
    return parsed;
  }
  if (typeof claimToken !== "string" || claimToken === "") {
    return { ok: false, error: INBOX_CLAIM_TOKEN_REQUIRED_ERROR };
  }
  const ttl = getInboxProcessedTtlSeconds();
  const marked = await callKv(() =>
    kv().markProcessedIfOwned(
      inboxClaimKey(parsed.messageId),
      inboxProcessedKey(parsed.messageId),
      claimToken,
      ttl
    )
  );
  if (!marked.ok) {
    return marked;
  }
  if (!marked.value) {
    return { ok: false, error: INBOX_CLAIM_LOST_ERROR };
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
    await releaseInboxClaim(messageId, claimed.token);
    return extracted;
  }
  return {
    ok: true,
    status: "extracted",
    jobDescription: extracted.jobDescription,
    claimToken: claimed.token,
  };
}
