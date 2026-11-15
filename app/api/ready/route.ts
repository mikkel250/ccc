/** Deploy readiness probe — auth, master CV cache, Redis env. No LLM. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { evaluateReadiness } from "../lib/readiness";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

export async function GET() {
  try {
    const result = await evaluateReadiness();
    return NextResponse.json(
      {
        service: "cv-tailoring-api",
        status: result.ok ? "ok" : "not_ready",
        checks: result.checks,
      },
      {
        status: result.ok ? 200 : 503,
        headers: NO_STORE_HEADERS,
      }
    );
  } catch (error: unknown) {
    console.error(
      "Readiness probe failed:",
      error instanceof Error ? error.name : "Error"
    );
    return NextResponse.json(
      {
        service: "cv-tailoring-api",
        status: "not_ready",
        checks: { auth: "failed", masterCv: "failed", redis: "failed" },
      },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }
}
