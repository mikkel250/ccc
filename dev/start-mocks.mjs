#!/usr/bin/env node
/**
 * Start the local Upstash REST and DeepSeek stand-ins and keep them in the foreground.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = ["upstash-rest-mock.mjs", "deepseek-mock.mjs"];
const children = files.map((file) => {
  const child = spawn(process.execPath, [path.join(dir, file)], {
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.exitCode = 1;
      return;
    }
    if (code && code !== 0) {
      process.exitCode = code;
    }
  });
  return child;
});

function shutdown() {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(130);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(143);
});
