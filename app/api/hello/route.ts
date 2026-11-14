/** Liveness probe — confirms the Node process is up. No LLM, master CV, or Redis. */
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    service: "cv-tailoring-api",
    status: "ok",
  });
}
