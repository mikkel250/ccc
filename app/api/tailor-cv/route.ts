export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "../lib/rate-limit";
import { getAllContext } from "../lib/knowledge-base";
import { getCvPrompt, compileCvPrompt } from "../lib/cv-prompt";
import { chat } from "../lib/llm";
import { markdownToDocxBase64 } from "../lib/markdown-docx";
import { validateTailorCvBody } from "../lib/tailor-cv-validation";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const ipAddress =
      request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") ||
      "unknown";

    const validated = validateTailorCvBody(body, `ip:${ipAddress}`);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const { jobDescription, sessionId } = validated;

    const rateLimit = checkRateLimit(sessionId, ipAddress);
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

    const context = getAllContext();
    const { systemPrompt: promptText, langfusePrompt } = await getCvPrompt();
    const systemPrompt = compileCvPrompt(promptText, context);

    const messages = [
      {
        role: "user" as const,
        content: `Tailor a CV for this job description:\n\n${jobDescription}`,
      },
    ];

    const tailorModel =
      process.env.TAILOR_MODEL ||
      process.env.AI_MODEL ||
      "gemini-2.5-pro";

    const llmResponse = await chat(messages, systemPrompt, {
      model: tailorModel,
      langfusePrompt: langfusePrompt ?? { name: "cv-tailor-system", version: 0, isFallback: true },
      source: "tailor-cv",
    });

    const cv = await markdownToDocxBase64(llmResponse.content);

    return NextResponse.json({
      cv,
      model: llmResponse.model,
      usage: llmResponse.usage,
      remaining: rateLimit.remaining,
      resetTime: rateLimit.resetTime,
    });
  } catch (error: unknown) {
    console.error("Tailor CV API error:", error);
    const message = error instanceof Error ? error.message : String(error);

    if (
      message.includes("OpenAI") ||
      message.includes("Anthropic") ||
      message.includes("Google") ||
      message.includes("All providers failed") ||
      message.includes("quota") ||
      message.includes("RESOURCE_EXHAUSTED")
    ) {
      return NextResponse.json(
        { error: "AI service error. Please try again." },
        { status: 503 }
      );
    }

    if (message.includes("Rate limit")) {
      return NextResponse.json({ error: message }, { status: 429 });
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
