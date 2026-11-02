const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

// Same falsy fallback as getTailorModel() in lib/env.ts:
// `process.env.TAILOR_MODEL || DEFAULT_TAILOR_MODEL`.
const DEFAULT_TAILOR_MODEL = "anthropic/sonnet";

/**
 * @param {string} name
 * @param {string | undefined} value
 * @param {number | undefined} expectedPort
 */
function assertLoopbackServiceUrl(name, value, expectedPort) {
  let url;
  try {
    url = new URL(String(value ?? ""));
  } catch {
    throw new Error(`${name} must be an http(s) URL on 127.0.0.1 or localhost`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must be an http(s) URL on 127.0.0.1 or localhost`);
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(`${name} must use host 127.0.0.1 or localhost`);
  }
  if (expectedPort === undefined) return;
  const port =
    url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
  if (port !== expectedPort) {
    throw new Error(`${name} must use port ${expectedPort}`);
  }
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 */
function resolvedTailorModel(env) {
  return env.TAILOR_MODEL || DEFAULT_TAILOR_MODEL;
}

/**
 * Provider is the first `/` segment, matching parseNamespacedProvider.
 * @param {string} model
 */
function usesDeepseekProvider(model) {
  const slash = model.indexOf("/");
  return slash > 0 && model.slice(0, slash) === "deepseek";
}

/**
 * Refuse live Upstash and DeepSeek URLs, and a tailor model that would not
 * stay on the local DeepSeek mock, for local mock commands.
 * When `ports` is set, the URL port must be the mock port `dev/up.sh` health-checks.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @param {{ upstash: number, deepseek: number } | undefined} [ports]
 */
export function assertLocalMockClientUrls(env, ports) {
  assertLoopbackServiceUrl(
    "UPSTASH_REDIS_REST_URL",
    env.UPSTASH_REDIS_REST_URL,
    ports?.upstash
  );
  assertLoopbackServiceUrl(
    "DEEPSEEK_BASE_URL",
    env.DEEPSEEK_BASE_URL,
    ports?.deepseek
  );
  const model = resolvedTailorModel(env);
  if (!usesDeepseekProvider(model)) {
    throw new Error(
      `TAILOR_MODEL must use the deepseek provider for local mocks (resolved ${JSON.stringify(model)})`
    );
  }
}
