/**
 * Production CV tailoring endpoint — orchestrates the full request pipeline.
 *
 * Flow: validate → rate-limit → load KB → compile prompt → LLM → DOCX → JSON.
 * Called by the CCC consumer app; see docs/arch/APP_WALKTHROUGH.md for the
 * step-by-step map of every function involved.
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { validateTailorCvBody } from "../lib/tailor-cv-validation";
import { getTailorModel } from "../../../lib/env";
import { RateLimitError, ServiceError } from "../lib/errors";
import { tailorCvDeps } from "../lib/tailor-cv-deps";

function isValidIp(value: string): boolean {
  if (value.length > 45) return false;
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  return ipv4Regex.test(value) || ipv6Regex.test(value);
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
  if (forwarded?.trim()) {
    const entries = forwarded.split(",").map(s => s.trim()).filter(Boolean);
    const rightmost = entries[entries.length - 1];
    if (rightmost && isValidIp(rightmost)) {
      return rightmost;
    }
  }

  return "unknown";
}

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    const ipAddress = parseClientIp(request);
    if (ipAddress === "unknown") {
      return NextResponse.json(
        { error: "Cannot determine client IP" },
        { status: 400 }
      );
    }

    const validated = validateTailorCvBody(body, `ip:${ipAddress}`);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const { jobDescription, sessionId } = validated;

    const rateLimit = await tailorCvDeps.checkRateLimit(sessionId, ipAddress);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: rateLimit.message || "Rate limit exceeded",
          remaining: rateLimit.remaining,
          resetTime: rateLimit.resetTime,
        },
        { status: 429 }
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

    return NextResponse.json({
      cv,
      model: llmResponse.model,
      usage: llmResponse.usage,
      remaining: rateLimit.remaining,
      resetTime: rateLimit.resetTime,
    });
  } catch (error: unknown) {
    console.error("Tailor CV API error:", error);

    if (error instanceof RateLimitError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }

    if (error instanceof ServiceError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }

    const message = error instanceof Error ? error.message : String(error);

    if (tailorCvDeps.isLlmServiceError(message)) {
      return NextResponse.json(
        { error: "AI service error. Please try again." },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: "Internal server error. Please try again later." },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { error: "Method not allowed. Use POST." },
    { status: 405 }
  );
}
