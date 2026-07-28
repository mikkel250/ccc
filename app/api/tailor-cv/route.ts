/**
 * Production CV tailoring endpoint — thin HTTP wrapper around the JSON curator pipeline.
 *
 * See docs/plans/2026-07-20-001-feat-json-curator-cv-pipeline-plan.md.
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { RateLimitError, ServiceError } from "../lib/errors";
import { tailorCvDeps } from "../lib/tailor-cv-deps";
import { buildTailorResponse } from "../lib/tailor-pipeline";
import { getRateLimitConfig } from "../lib/rate-limit";

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

function safeTailorLog(message: string, error?: unknown): void {
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

function retryAfterSeconds(resetTime: number): string {
  return String(Math.max(1, Math.ceil((resetTime - Date.now()) / 1000)));
}

function mapPipelineResult(
  result: Awaited<ReturnType<typeof buildTailorResponse>>
): NextResponse {
  if (result.ok) {
    return jsonResponse(result.body, 200);
  }
  const headers =
    result.resetTime !== undefined
      ? { "Retry-After": retryAfterSeconds(result.resetTime) }
      : undefined;
  if (result.status === 429 && result.resetTime !== undefined) {
    return jsonResponse(
      {
        error: result.error,
        remaining: result.remaining ?? 0,
        resetTime: result.resetTime,
      },
      result.status,
      headers
    );
  }
  return jsonResponse({ error: result.error }, result.status, headers);
}

export async function POST(request: NextRequest) {
  try {
    return mapPipelineResult(
      await buildTailorResponse(tailorCvDeps, request)
    );
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
