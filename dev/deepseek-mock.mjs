#!/usr/bin/env node
/**
 * OpenAI-compatible DeepSeek stand-in for local tailor connectivity tests.
 * Returns schema-valid curator JSON (strict wrapper) from the sample master CV.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { guardMockRequest } from "./mock-request.mjs";

export const DEFAULT_DEEPSEEK_MOCK_PORT = 4010;

function defaultSamplePath() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(
    here,
    "..",
    "references",
    "json-curator",
    "master-cv.schema-sample.json"
  );
}

export function loadCuratorPayload(cvPath = process.env.MOCK_MASTER_CV_PATH) {
  const resolved = cvPath && cvPath.trim() !== "" ? cvPath : defaultSamplePath();
  const curated = JSON.parse(fs.readFileSync(resolved, "utf8"));
  return JSON.stringify({
    curated_cv: curated,
    reply_text:
      "Thank you for reaching out. I would welcome a conversation about this role.",
  });
}

export function createDeepseekMockHandler(options = {}) {
  const payload = options.payload ?? loadCuratorPayload(options.cvPath);
  return async function handle(req, res) {
    const url = req.url || "/";
    if (req.method === "GET" && (url === "/health" || url.startsWith("/health?"))) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (req.method === "POST" && /\/chat\/completions\/?$/.test(url)) {
      for await (const _chunk of req) {
        // drain
      }
      const body = {
        id: "chatcmpl-local-mock",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "deepseek-chat",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: payload },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 48, total_tokens: 60 },
      };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: `unhandled ${req.method} ${url}` } }));
  };
}

export function listenDeepseekMock(options = {}) {
  const port = Number(
    options.port ?? process.env.DEEPSEEK_MOCK_PORT ?? DEFAULT_DEEPSEEK_MOCK_PORT
  );
  const handle = createDeepseekMockHandler(options);
  const server = http.createServer((req, res) => {
    guardMockRequest(handle, req, res);
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`deepseek-mock listening on http://127.0.0.1:${port}`);
  });
  return { server };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  listenDeepseekMock();
}
