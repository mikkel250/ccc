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
import {
  REQUEST_ID_HEADER,
  generateRequestId,
  resolveRequestId,
} from "../lib/request-id";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function jsonResponse(
  body: unknown,
  status: number,
  requestId: string,
  extraHeaders?: Record<string, string>
): NextResponse {
  const payload =
    status >= 400 && body !== null && typeof body === "object"
      ? { ...body, requestId }
      : body;
  return NextResponse.json(payload, {
    status,
    headers: {
      ...NO_STORE_HEADERS,
      [REQUEST_ID_HEADER]: requestId,
      ...extraHeaders,
    },
  });
}

function safeTailorLog(
  message: string,
  requestId: string,
  error?: unknown
): void {
  const isProduction = process.env.NODE_ENV === "production";
  if (error instanceof Error) {
    console.error(message, {
      requestId,
      name: error.name,
      message: error.message,
      ...(isProduction ? {} : { stack: error.stack }),
    });
    return;
  }
  if (error !== undefined) {
    console.error(message, { requestId, error: String(error) });
    return;
  }
  console.error(message, { requestId });
}

function retryAfterSeconds(resetTime: number): string {
  return String(Math.max(1, Math.ceil((resetTime - Date.now()) / 1000)));
}

function mapPipelineResult(
  result: Awaited<ReturnType<typeof buildTailorResponse>>,
  requestId: string
): NextResponse {
  if (result.ok) {
    return jsonResponse(result.body, 200, requestId);
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
      requestId,
      headers
    );
  }
  return jsonResponse({ error: result.error }, result.status, requestId, headers);
}

export async function POST(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  try {
    return mapPipelineResult(
      await buildTailorResponse(tailorCvDeps, request),
      requestId
    );
  } catch (error: unknown) {
    safeTailorLog("Tailor CV API error:", requestId, error);
    return mapErrorToResponse(error, requestId);
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

function mapErrorToResponse(error: unknown, requestId: string) {
  for (const entry of ERROR_RESPONSES) {
    if (!entry.matches(error)) continue;
    return jsonResponse(
      entry.body(error),
      entry.status,
      requestId,
      entry.headers?.()
    );
  }
  return jsonResponse(
    { error: "Internal server error. Please try again later." },
    500,
    requestId
  );
}

export async function GET() {
  return jsonResponse(
    { error: "Method not allowed. Use POST." },
    405,
    generateRequestId()
  );
}
