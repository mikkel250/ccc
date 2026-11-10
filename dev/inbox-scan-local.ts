/**
 * Scan labeled recruiter mail against in-process Gmail fixtures and the local
 * Upstash REST mock. Does not call live Gmail. HTTPS Gmail URL policy is unchanged.
 *
 * Usage: npm run inbox:scan:local
 *
 * Blank Redis, DeepSeek, and tailor-model settings are filled with the local
 * mock defaults before the loopback check. Existing values are left as-is.
 * Set INBOX_SCAN_LOCAL_REDIS_PROBE=1 to exercise Redis helpers after the scan.
 */
import { config as loadDotenv } from "dotenv";
import { pathToFileURL } from "node:url";
import { inboxProcessedKey } from "../app/api/lib/inbox-processed-store";
import { scanInbox, type InboxScanResult } from "../app/api/lib/inbox-scan";
import { preloadMasterCv } from "../app/api/lib/master-cv";
import { getEnvBoolean, getEnvString } from "../lib/env";
import { inboxScanCliExitCode } from "../scripts/inbox-scan";
import { DEFAULT_DEEPSEEK_MOCK_PORT } from "./deepseek-mock.mjs";
import {
  applyLocalInboxGmailEnv,
  assertLocalInboxGmailUrlsAreHttps,
  createGmailFetchFixture,
  LOCAL_INBOX_MESSAGE_ID,
} from "./gmail-fetch-fixture";
import { assertLocalMockClientUrls } from "./local-service-urls.mjs";
import {
  DEFAULT_UPSTASH_REST_PORT,
  DEFAULT_UPSTASH_REST_TOKEN,
} from "./upstash-rest-mock.mjs";

const DEFAULT_LOCAL_MOCK_TAILOR_MODEL = "deepseek/deepseek-chat";
const DEFAULT_LOCAL_MOCK_DEEPSEEK_API_KEY = "local-dev-deepseek-key";
const DEFAULT_LOCAL_REDIS_PROBE_KEY = "inbox:local-dev-probe";

/** Local-mock default, replaced when the named env var is nonblank. */
function localMockSetting(key: string, fallback: string): string {
  return getEnvString(key, fallback) ?? fallback;
}

/** Set an env value only when the current one is missing or blank. */
function fillBlank(env: NodeJS.ProcessEnv, key: string, value: string): void {
  const current = env[key];
  if (current === undefined || current.trim() === "") {
    env[key] = value;
  }
}

/** Fill blank local-mock client settings. A value that is already set stays as-is. */
export function applyLocalInboxMockClientEnv(env: NodeJS.ProcessEnv = process.env): void {
  const upstashPort = env.UPSTASH_REST_PORT?.trim() || String(DEFAULT_UPSTASH_REST_PORT);
  const deepseekPort = env.DEEPSEEK_MOCK_PORT?.trim() || String(DEFAULT_DEEPSEEK_MOCK_PORT);
  fillBlank(env, "UPSTASH_REDIS_REST_URL", `http://127.0.0.1:${upstashPort}`);
  fillBlank(env, "UPSTASH_REDIS_REST_TOKEN", DEFAULT_UPSTASH_REST_TOKEN);
  fillBlank(env, "DEEPSEEK_BASE_URL", `http://127.0.0.1:${deepseekPort}`);
  fillBlank(
    env,
    "DEEPSEEK_API_KEY",
    localMockSetting("LOCAL_MOCK_DEEPSEEK_API_KEY", DEFAULT_LOCAL_MOCK_DEEPSEEK_API_KEY)
  );
  fillBlank(
    env,
    "TAILOR_MODEL",
    localMockSetting("LOCAL_MOCK_TAILOR_MODEL", DEFAULT_LOCAL_MOCK_TAILOR_MODEL)
  );
}

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

export type LocalRedisProbe = {
  usedHelpers: boolean;
  get: unknown;
  eval: unknown;
  error?: string;
};

/**
 * Scan local Gmail fixtures and read the processed mark.
 * The Redis probe runs only when INBOX_SCAN_LOCAL_REDIS_PROBE is set.
 */
export async function runLocalInboxScan(options?: {
  scan?: () => Promise<InboxScanResult>;
  redisMod?: RedisHelperModule;
  messageId?: string;
}): Promise<{
  ok: boolean;
  scan: InboxScanResult;
  processed: unknown;
  redisProbe: LocalRedisProbe | null;
}> {
  applyLocalInboxMockClientEnv();
  applyLocalInboxGmailEnv();
  assertLocalMockClientUrls(process.env);
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
  let redisProbe: LocalRedisProbe | null = null;
  if (getEnvBoolean("INBOX_SCAN_LOCAL_REDIS_PROBE", false)) {
    try {
      redisProbe = await probeRedisHelpers(
        redisMod,
        localMockSetting("LOCAL_REDIS_PROBE_KEY", DEFAULT_LOCAL_REDIS_PROBE_KEY)
      );
    } catch (error) {
      redisProbe = {
        usedHelpers: false,
        get: null,
        eval: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return { ok: result.ok, scan: result, processed, redisProbe };
}

export async function runLocalInboxCli(options?: {
  scan?: () => Promise<InboxScanResult>;
  redisMod?: RedisHelperModule;
  messageId?: string;
}): Promise<{ exitCode: 0 | 1 }> {
  const result = await runLocalInboxScan(options);
  console.log(JSON.stringify(result, null, 2));
  return { exitCode: inboxScanCliExitCode(result.scan) };
}

export async function main(): Promise<void> {
  loadDotenv({ path: ".env.local" });
  loadDotenv();
  try {
    const outcome = await runLocalInboxCli();
    process.exitCode = outcome.exitCode;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
