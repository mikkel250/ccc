#!/usr/bin/env node
/**
 * Start the local Upstash REST and DeepSeek stand-ins and keep them in the foreground.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

/**
 * @typedef {{
 *   killed?: boolean,
 *   exitCode?: number | null,
 *   on: (event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void) => void,
 *   kill?: (signal?: NodeJS.Signals) => void,
 * }} MockChild
 */

/**
 * @param {MockChild[]} children
 * @param {{
 *   kill?: (child: MockChild) => void,
 *   exitProcess?: (status: number) => void,
 * }} [hooks]
 */
export function attachMockExitGuard(children, hooks = {}) {
  const kill =
    hooks.kill ??
    ((child) => {
      child.kill?.("SIGTERM");
    });
  const exitProcess =
    hooks.exitProcess ??
    ((status) => {
      process.exitCode = status;
      process.exit(status);
    });
  let shuttingDown = false;

  function shutdown(status, source) {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children) {
      if (child === source) continue;
      if (child.exitCode == null && !child.killed) kill(child);
    }
    exitProcess(status);
  }

  for (const child of children) {
    child.on("exit", (code, signal) => {
      if (shuttingDown) return;
      shutdown(signal ? 1 : code ?? 1, child);
    });
  }

  return { shutdown };
}

function main() {
  const files = ["upstash-rest-mock.mjs", "deepseek-mock.mjs"];
  const children = files.map((file) =>
    spawn(process.execPath, [path.join(dir, file)], {
      stdio: "inherit",
      env: process.env,
    })
  );
  const guard = attachMockExitGuard(children);
  process.on("SIGINT", () => {
    guard.shutdown(130);
  });
  process.on("SIGTERM", () => {
    guard.shutdown(143);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
