/**
 * Scan labeled recruiter mail against in-process Gmail fixtures and the local
 * Upstash REST mock. Does not call live Gmail. HTTPS Gmail URL policy is unchanged.
 *
 * Usage: npm run inbox:scan:local
 *
 * Redis helpers (`getRedisKey` / `setRedisKey` / `evalRedisScript`) land in PR #66.
 * This runner uses them when present and otherwise falls back to `Redis#get/set/eval`.
 */
import { config as loadDotenv } from "dotenv";
import { pathToFileURL } from "node:url";
import { inboxProcessedKey } from "../app/api/lib/inbox-processed-store";
import { scanInbox, type InboxScanResult } from "../app/api/lib/inbox-scan";
import { preloadMasterCv } from "../app/api/lib/master-cv";
import {
  applyLocalInboxGmailEnv,
  assertLocalInboxGmailUrlsAreHttps,
  createGmailFetchFixture,
  LOCAL_INBOX_MESSAGE_ID,
} from "./gmail-fetch-fixture";

export type RedisClientLike = {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: string, opts?: { ex?: number }) => Promise<unknown>;
  eval: (script: string, keys: string[], args: string[]) => Promise<unknown>;
};

export type RedisHelperModule = {
  getRedisClient: () => RedisClientLike;
  getRedisKey?: (
    client: RedisClientLike,
    key: string,
    ...extra: unknown[]
  ) => Promise<unknown>;
  setRedisKey?: (
    client: RedisClientLike,
    key: string,
    value: string,
    opts?: { ex?: number },
    ...extra: unknown[]
  ) => Promise<unknown>;
  evalRedisScript?: (
    client: RedisClientLike,
    script: string,
    key: string,
    args: string[],
    ...extra: unknown[]
  ) => Promise<unknown>;
};

const GET_SCRIPT = 'return redis.call("GET", KEYS[1])';

function isMissingCommandConstructor(error: unknown): boolean {
  return (
    error instanceof Error &&
    /(?:Get|Set|Eval)Command is not a constructor/.test(error.message)
  );
}

export async function probeRedisHelpers(
  redisMod: RedisHelperModule,
  probeKey: string
): Promise<{ usedHelpers: boolean; get: unknown; eval: unknown }> {
  const client = redisMod.getRedisClient();
  if (redisMod.getRedisKey && redisMod.setRedisKey && redisMod.evalRedisScript) {
    try {
      await redisMod.setRedisKey(client, probeKey, "ok", { ex: 60 });
      const got = await redisMod.getRedisKey(client, probeKey);
      const evaluated = await redisMod.evalRedisScript(
        client,
        GET_SCRIPT,
        probeKey,
        []
      );
      return { usedHelpers: true, get: got, eval: evaluated };
    } catch (error) {
      if (!isMissingCommandConstructor(error)) {
        throw error;
      }
      // Pre-#66 helpers construct Command classes that are not runtime exports.
    }
  }
  await client.set(probeKey, "ok", { ex: 60 });
  const got = await client.get(probeKey);
  const evaluated = await client.eval(GET_SCRIPT, [probeKey], []);
  return { usedHelpers: false, get: got, eval: evaluated };
}

export async function readProcessedMark(
  redisMod: RedisHelperModule,
  messageId: string
): Promise<unknown> {
  const client = redisMod.getRedisClient();
  const key = inboxProcessedKey(messageId);
  if (redisMod.getRedisKey) {
    try {
      return await redisMod.getRedisKey(client, key);
    } catch (error) {
      if (!isMissingCommandConstructor(error)) {
        throw error;
      }
      // Pre-#66 helpers construct Command classes that are not runtime exports.
    }
  }
  return client.get(key);
}

export async function runLocalInboxScan(options?: {
  scan?: () => Promise<InboxScanResult>;
  redisMod?: RedisHelperModule;
  messageId?: string;
}): Promise<{
  ok: boolean;
  scan: InboxScanResult;
  processed: unknown;
  redisProbe: { usedHelpers: boolean; get: unknown; eval: unknown };
}> {
  applyLocalInboxGmailEnv();
  assertLocalInboxGmailUrlsAreHttps();
  const loaded = await preloadMasterCv();
  if (!loaded.ok) {
    throw new Error(loaded.error);
  }
  const scan =
    options?.scan ??
    (() => scanInbox({ fetchImpl: createGmailFetchFixture() }));
  const result = await scan();
  const redisMod =
    options?.redisMod ??
    ((await import("../app/api/lib/redis")) as unknown as RedisHelperModule);
  const messageId = options?.messageId ?? LOCAL_INBOX_MESSAGE_ID;
  const processed = await readProcessedMark(redisMod, messageId);
  const redisProbe = await probeRedisHelpers(
    redisMod,
    "inbox:local-dev-probe"
  );
  return { ok: result.ok, scan: result, processed, redisProbe };
}

export async function main(): Promise<void> {
  loadDotenv({ path: ".env.local" });
  loadDotenv();
  try {
    const result = await runLocalInboxScan();
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok && result.scan.ok ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
