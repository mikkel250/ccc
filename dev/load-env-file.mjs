import { parseEnv } from "node:util";

const SHELL_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function shellSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Bash `export` lines for keys in an env file that are not already set.
 * Existing environment variables win, matching `node --env-file`.
 * @param {string} fileText
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 */
export function formatUnsetExports(fileText, env) {
  const parsed = parseEnv(fileText);
  let out = "";
  for (const [key, value] of Object.entries(parsed)) {
    if (!SHELL_KEY.test(key)) continue;
    if (Object.hasOwn(env, key)) continue;
    out += `export ${key}=${shellSingleQuote(value)}\n`;
  }
  return out;
}
