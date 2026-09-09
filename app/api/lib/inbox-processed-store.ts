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
import { evalRedisScript, getRedisClient, getRedisKey, setRedisKey } from "./redis";

export type InboxKv = {
  get: (key: string) => Promise<string | null>;
  set: (
    key: string,
    value: string,
    opts?: { nx?: boolean; ex?: number }
  ) => Promise<"OK" | null>;
  deleteIfValue: (key: string, value: string) => Promise<boolean>;
};

export type ExtractUnprocessedResult =
  | { ok: true; status: "extracted"; jobDescription: string; claimToken: string }
  | { ok: true; status: "skipped-processed" }
  | { ok: true; status: "skipped-claimed" }
  | { ok: false; error: string };

const MESSAGE_ID_RE = /^[A-Za-z0-9._-]+$/;
const DELETE_IF_VALUE_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

let injectedKv: InboxKv | null = null;

export function __injectInboxKvForTest(kv: InboxKv | null): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("__injectInboxKvForTest is only available in the test environment");
  }
  injectedKv = kv;
}

function isInboxRedisTimeout(err: unknown): boolean {
  return err instanceof Error && err.message === "Inbox Redis timed out";
}

async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Inbox Redis timed out"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function kv(): InboxKv {
  if (injectedKv) {
    return injectedKv;
  }
  const client = getRedisClient();
  const timeoutMs = getInboxRedisTimeoutMs();
  return {
    get: async (key) => {
      const value = await withTimeout(
        (signal) => getRedisKey(client, key, signal),
        timeoutMs
      );
      return typeof value === "string" ? value : value == null ? null : String(value);
    },
    set: async (key, value, opts) => {
      let result: unknown;
      if (opts?.nx === true) {
        result = await withTimeout(
          (signal) =>
            setRedisKey(
              client,
              key,
              value,
              {
                nx: true,
                ex: opts.ex ?? getInboxClaimTtlSeconds(),
              },
              signal
            ),
          timeoutMs
        );
      } else if (opts?.ex !== undefined) {
        const ttlSeconds = opts.ex;
        result = await withTimeout(
          (signal) => setRedisKey(client, key, value, { ex: ttlSeconds }, signal),
          timeoutMs
        );
      } else {
        result = await withTimeout(
          (signal) => setRedisKey(client, key, value, undefined, signal),
          timeoutMs
        );
      }
      return result === "OK" ? "OK" : null;
    },
    deleteIfValue: async (key, value) => {
      const deleted = await withTimeout(
        (signal) =>
          evalRedisScript(
            client,
            DELETE_IF_VALUE_SCRIPT,
            key,
            [value],
            signal
          ),
        timeoutMs
      );
      return deleted === 1;
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
): Promise<
  | { ok: true; outcome: "won"; token: string }
  | { ok: true; outcome: "lost" }
  | { ok: true; outcome: "processed" }
  | { ok: false; error: string }
> {
  const parsed = parseInboxMessageId(messageId);
  if (!parsed.ok) {
    return parsed;
  }
  if (await isInboxProcessed(parsed.messageId)) {
    return { ok: true, outcome: "processed" };
  }
  const token = randomBytes(16).toString("hex");
  const claimKey = inboxClaimKey(parsed.messageId);
  const store = kv();
  let claimed = false;
  for (let attempt = 0; attempt < 2 && !claimed; attempt += 1) {
    let set: "OK" | null = null;
    let setTimedOut = false;
    try {
      set = await store.set(claimKey, token, {
        nx: true,
        ex: getInboxClaimTtlSeconds(),
      });
    } catch (err) {
      if (!isInboxRedisTimeout(err)) {
        throw err;
      }
      setTimedOut = true;
    }
    if (set === "OK") {
      claimed = true;
      break;
    }
    if (setTimedOut) {
      break;
    }
    const existing = await store.get(claimKey);
    if (existing === token) {
      claimed = true;
      break;
    }
    if (existing != null) {
      break;
    }
  }
  if (claimed) {
    const processed = await isInboxProcessed(parsed.messageId);
    const currentClaim = await store.get(claimKey);
    if (processed) {
      if (currentClaim === token) {
        await store.deleteIfValue(claimKey, token);
      }
      return { ok: true, outcome: "processed" };
    }
    if (currentClaim === token) {
      return { ok: true, outcome: "won", token };
    }
    return { ok: true, outcome: "lost" };
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

export async function releaseInboxClaim(
  messageId: string,
  token: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = parseInboxMessageId(messageId);
  if (!parsed.ok) {
    return parsed;
  }
  try {
    await kv().deleteIfValue(inboxClaimKey(parsed.messageId), token);
  } catch {
    return { ok: false, error: "Failed to release inbox claim" };
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
    claimToken: claimed.token,
  };
}
