/**
 * Production CV tailoring endpoint — orchestrates the full request pipeline.
 *
 * Flow: auth → validate → rate-limit → load KB → compile prompt → LLM → DOCX → JSON.
 * Called by the CCC consumer app; see docs/arch/APP_WALKTHROUGH.md for the
 * step-by-step map of every function involved.
 */
export const runtime = "nodejs";

import { isIP } from "node:net";
import { NextRequest, NextResponse } from "next/server";
import { validateTailorCvBody } from "../lib/tailor-cv-validation";
import { getTailorModel } from "../../../lib/env";
import { RateLimitError, ServiceError } from "../lib/errors";
import { tailorCvDeps } from "../lib/tailor-cv-deps";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function jsonResponse(
  body: unknown,
  status: number
): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

function isValidIp(value: string): boolean {
  if (value.length > 45) return false;
  return isIP(value) !== 0;
}

/**
 * Resolve the client IP from `x-forwarded-for`.
 *
 * `NextRequest.ip`/`.geo` were removed in Next.js 15 and have no
 * hosting-agnostic replacement; a Route Handler has no way to inspect the
 * raw connecting-peer address on Railway (no `@vercel/functions` here).
 * The rightmost entry is trusted because it is the one *our own* edge proxy
 * appends when forwarding — true whether Railway overwrites the header or
 * appends to whatever a client already sent, so a client-injected leftmost
 * value can never override it. Returns "unknown" when no valid IP is found.
 */
function parseClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded?.trim()) return "unknown";

  const entries = forwarded.split(",");
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!.trim();
    if (!entry) continue;
    return isValidIp(entry) ? entry : "unknown";
  }
  return "unknown";
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
      return jsonResponse(
        { error: "Cannot determine client IP" },
        400
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(
        { error: "Invalid JSON in request body" },
        400
      );
    }

    const validated = validateTailorCvBody(body, `ip:${ipAddress}`);
    if (!validated.ok) {
      return jsonResponse({ error: validated.error }, 400);
    }

    const { jobDescription, sessionId } = validated;

    const rateLimit = await tailorCvDeps.checkRateLimit(sessionId, ipAddress);
    if (!rateLimit.allowed) {
      return jsonResponse(
        {
          error: rateLimit.message || "Rate limit exceeded",
          remaining: rateLimit.remaining,
          resetTime: rateLimit.resetTime,
        },
        429
      );
    }

    const context = tailorCvDeps.getAllContext();
    const { systemPrompt: promptText, langfusePrompt } = await tailorCvDeps.getCvPrompt();
    const systemPrompt = tailorCvDeps.compileCvPrompt(promptText, context);

    const messages = [
      {
        role: "user" as const,
        content: `Tailor a CV for this job description:\n\n${jobDescription}`,
      },
    ];

    const llmResponse = await tailorCvDeps.chat(messages, systemPrompt, {
      model: getTailorModel(),
      langfusePrompt: langfusePrompt ?? { name: "cv-tailor-system", version: 0, isFallback: true },
      source: "tailor-cv",
    });

    const cv = await tailorCvDeps.markdownToDocxBase64(llmResponse.content);

    return jsonResponse({
      cv,
      model: llmResponse.model,
      usage: llmResponse.usage,
      remaining: rateLimit.remaining,
      resetTime: rateLimit.resetTime,
    }, 200);
  } catch (error: unknown) {
    // Log only name/message/stack. Provider SDKs (OpenAI, Anthropic, Upstash) often
    // attach `request`, `response`, `config`, and header objects to their thrown
    // Errors; dumping the raw error can leak Authorization headers, request bodies,
    // or PII into logs. Stringify the safe subset explicitly.
    if (error instanceof Error) {
      console.error("Tailor CV API error:", {
        name: error.name,
        message: error.message,
        stack: error.stack,
      });
    } else {
      console.error("Tailor CV API error (non-Error thrown):", String(error));
    }

    return mapErrorToResponse(error);
  }
}

/**
 * Maps a caught error to its HTTP response. Table-driven (checked top to
 * bottom, first match wins) so the security-sensitive decision — which
 * errors get their raw `.message` forwarded to the client vs. masked with a
 * generic string — is auditable in one place instead of interleaved `if`s.
 */
type ErrorResponseEntry = {
  matches: (error: unknown) => boolean;
  status: 429 | 503;
  body: (error: unknown) => { error: string };
};

const ERROR_RESPONSES: ErrorResponseEntry[] = [
  {
    matches: (error): error is RateLimitError => error instanceof RateLimitError,
    status: 429,
    body: (error) => ({ error: (error as RateLimitError).message }),
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
    return jsonResponse(entry.body(error), entry.status);
  }
  return jsonResponse(
    { error: "Internal server error. Please try again later." },
    500
  );
}

export async function GET() {
  return jsonResponse(
    { error: "Method not allowed. Use POST." },
    405
  );
}
