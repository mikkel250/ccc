/**
 * Production CV tailoring endpoint — JSON curator pipeline.
 *
 * Flow: auth → IP → rate-limit → body size → validate JD → load master → curator LLM →
 * schema/size → docx → dual JSON response. See docs/plans/2026-07-20-001-feat-json-curator-cv-pipeline-plan.md.
 */
export const runtime = "nodejs";

import { isIP } from "node:net";
import { NextRequest, NextResponse } from "next/server";
import { validateTailorCvBody } from "../lib/tailor-cv-validation";
import { getTailorModel } from "../../../lib/env";
import { RateLimitError, ServiceError } from "../lib/errors";
import { tailorCvDeps } from "../lib/tailor-cv-deps";
import { getConfiguredTailorApiKey } from "../lib/tailor-auth";
import { hashTailorApiKeyForRateLimit, getRateLimitConfig } from "../lib/rate-limit";
import {
  getTailorRequestMaxBytes,
  getTailorResponseMaxBytes,
} from "../lib/cv-schema";
import { CURATOR_LANGFUSE_PROMPT_NAME } from "../lib/curator-prompt";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders?: Record<string, string>
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: extraHeaders
      ? { ...NO_STORE_HEADERS, ...extraHeaders }
      : NO_STORE_HEADERS,
  });
}

function retryAfterSeconds(resetTime: number): string {
  return String(Math.max(1, Math.ceil(resetTime - Date.now() / 1000)));
}

/** Reject values too long to be valid IP addresses (IPv6 with zone ID ≤ 55 chars). */
function isValidIp(value: string): boolean {
  if (value.length > 55) return false;
  return isIP(value) !== 0;
}

/**
 * Resolve the client IP from `x-forwarded-for`.
 * The rightmost entry is trusted (appended by our edge proxy).
 */
/** Max rightmost x-forwarded-for entries to examine before giving up. */
const MAX_XFF_ENTRIES = 5;

function parseClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded?.trim()) return "unknown";

  const entries = forwarded.split(",");
  // Only examine the rightmost N entries (nearest proxy chain hops).
  const start = Math.max(0, entries.length - MAX_XFF_ENTRIES);
  for (let i = entries.length - 1; i >= start; i--) {
    const entry = entries[i]!.trim();
    if (!entry) continue;
    return isValidIp(entry) ? entry : "unknown";
  }
  return "unknown";
}

function safeTailorLog(message: string, error?: unknown): void {
  // Never log master/curated/JD payloads (R18).
  const isProduction = process.env.NODE_ENV === "production";
  if (error instanceof Error) {
    console.error(message, {
      name: error.name,
      message: error.message,
      ...(isProduction ? {} : { stack: error.stack }),
    });
    return;
  }
  if (error !== undefined) {
    console.error(message, String(error));
    return;
  }
  console.error(message);
}

/**
 * Read request body with a hard byte cap (Content-Length early reject + stream).
 */
async function readRequestBodyCapped(
  request: NextRequest,
  maxBytes: number
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      return { ok: false, error: "Request body too large" };
    }
  }

  const reader = request.body?.getReader();
  if (!reader) {
    try {
      const text = await request.text();
      if (Buffer.byteLength(text, "utf8") > maxBytes) {
        return { ok: false, error: "Request body too large" };
      }
      return { ok: true, text };
    } catch {
      return { ok: false, error: "Invalid request body" };
    }
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, error: "Request body too large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, error: "Invalid request body" };
  }

  return { ok: true, text: Buffer.concat(chunks).toString("utf8") };
}

export async function POST(request: NextRequest) {
  try {
    const auth = tailorCvDeps.authenticateTailorRequest(
      request.headers.get("authorization")
    );
    if (!auth.ok) {
      return jsonResponse({ error: auth.error }, auth.status);
    }

    const ipAddress = parseClientIp(request);
    if (ipAddress === "unknown") {
      return jsonResponse({ error: "Cannot determine client IP" }, 400);
    }

    const configuredKey = getConfiguredTailorApiKey();
    const secretBucketKey = configuredKey
      ? hashTailorApiKeyForRateLimit(configuredKey)
      : hashTailorApiKeyForRateLimit(`bypass:${auth.mode}`);

    // Rate-limit before body work so invalid/authorized floods still hit Redis ceilings.
    const rateLimit = await tailorCvDeps.checkRateLimit(
      "pre-body",
      ipAddress,
      secretBucketKey
    );
    if (!rateLimit.allowed) {
      return jsonResponse(
        {
          error: rateLimit.message || "Rate limit exceeded",
          remaining: rateLimit.remaining,
          resetTime: rateLimit.resetTime,
        },
        429,
        { "Retry-After": retryAfterSeconds(rateLimit.resetTime) }
      );
    }

    const maxRequestBytes = getTailorRequestMaxBytes();
    const bodyRead = await readRequestBodyCapped(request, maxRequestBytes);
    if (!bodyRead.ok) {
      const status =
        bodyRead.error === "Request body too large" ? 413 : 400;
      return jsonResponse({ error: bodyRead.error }, status);
    }

    let body: unknown;
    try {
      body = JSON.parse(bodyRead.text);
    } catch {
      return jsonResponse({ error: "Invalid JSON in request body" }, 400);
    }

    const validated = validateTailorCvBody(body, `ip:${ipAddress}`);
    if (!validated.ok) {
      return jsonResponse({ error: validated.error }, 400);
    }

    const { jobDescription, curationMode } = validated;

    const masterCv = tailorCvDeps.requireMasterCv();
    const { systemPrompt: promptText, langfusePrompt } =
      await tailorCvDeps.getCuratorPrompt();
    const modePrompt = tailorCvDeps.applyCurationModePolicy(
      promptText,
      curationMode
    );
    const compiled = tailorCvDeps.compileCuratorPrompt(modePrompt, masterCv);
    if (!compiled.ok) {
      return jsonResponse({ error: compiled.error }, 503);
    }
    const systemPrompt = compiled.systemPrompt;
    const userContent = tailorCvDeps.buildCuratorUserMessage(
      jobDescription,
      curationMode
    );

    const llmResponse = await tailorCvDeps.chat(
      [{ role: "user" as const, content: userContent }],
      systemPrompt,
      {
        model: getTailorModel(),
        langfusePrompt: langfusePrompt ?? {
          name: CURATOR_LANGFUSE_PROMPT_NAME,
          version: 0,
          isFallback: true,
        },
        source: "tailor-cv-curator",
      }
    );

    let curatedRaw: unknown;
    try {
      curatedRaw = tailorCvDeps.extractStructuredJson(llmResponse.content);
    } catch {
      safeTailorLog("Curator output was not valid JSON");
      return jsonResponse(
        { error: "Curator output was not valid JSON" },
        422
      );
    }

    const schemaResult = tailorCvDeps.validateCvJson(curatedRaw);
    if (!schemaResult.ok) {
      safeTailorLog("Curator output failed schema validation");
      return jsonResponse(
        { error: "Curator output failed schema validation" },
        422
      );
    }

    const sizeResult = tailorCvDeps.assertCuratedJsonSize(schemaResult.data);
    if (!sizeResult.ok) {
      return jsonResponse({ error: sizeResult.error }, 422);
    }

    const sanitized = tailorCvDeps.sanitizeForResponse(schemaResult.data);

    const built = await tailorCvDeps.buildJsonDocxBase64(schemaResult.data);
    if (!built.ok) {
      safeTailorLog("Docx builder failed after valid curated JSON");
      return jsonResponse(
        { error: "Failed to render CV document" },
        422
      );
    }

    const responseBody = {
      cv: built.base64,
      curatedJson: sanitized,
      builderVersion: built.builderVersion,
      curationMode,
      model: llmResponse.model,
      usage: llmResponse.usage,
      remaining: rateLimit.remaining,
      resetTime: rateLimit.resetTime,
    };

    const responseBytes = Buffer.byteLength(
      JSON.stringify(responseBody),
      "utf8"
    );
    if (responseBytes > getTailorResponseMaxBytes()) {
      return jsonResponse(
        { error: "Tailor response exceeds configured size limit" },
        422
      );
    }

    return jsonResponse(responseBody, 200);
  } catch (error: unknown) {
    safeTailorLog("Tailor CV API error:", error);
    return mapErrorToResponse(error);
  }
}

type ErrorResponseEntry = {
  matches: (error: unknown) => boolean;
  status: 429 | 503;
  body: (error: unknown) => { error: string };
  headers?: () => Record<string, string>;
};

const ERROR_RESPONSES: ErrorResponseEntry[] = [
  {
    matches: (error): error is RateLimitError => error instanceof RateLimitError,
    status: 429,
    body: (error) => ({ error: (error as RateLimitError).message }),
    // No resetTime on the error class — use the configured window as delay-seconds.
    headers: () => ({
      "Retry-After": String(
        Math.max(1, Math.ceil(getRateLimitConfig().windowMs / 1000))
      ),
    }),
  },
  {
    matches: (error): error is ServiceError => error instanceof ServiceError,
    status: 503,
    body: (error) => ({ error: (error as ServiceError).message }),
  },
  {
    matches: (error) =>
      tailorCvDeps.isLlmServiceError(
        error instanceof Error ? error.message : String(error)
      ),
    status: 503,
    body: () => ({ error: "AI service error. Please try again." }),
  },
];

function mapErrorToResponse(error: unknown) {
  for (const entry of ERROR_RESPONSES) {
    if (!entry.matches(error)) continue;
    return jsonResponse(entry.body(error), entry.status, entry.headers?.());
  }
  return jsonResponse(
    { error: "Internal server error. Please try again later." },
    500
  );
}

export async function GET() {
  return jsonResponse({ error: "Method not allowed. Use POST." }, 405);
}
