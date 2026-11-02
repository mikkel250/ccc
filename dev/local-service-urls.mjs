const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

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
 * Refuse live Upstash and DeepSeek URLs for local mock commands.
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
}
