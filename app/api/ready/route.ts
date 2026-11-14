/** Deploy readiness probe — auth, master CV cache, Redis env. No LLM. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { evaluateReadiness } from "../lib/readiness";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

export async function GET() {
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
}
