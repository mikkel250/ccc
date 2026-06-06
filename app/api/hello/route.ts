/** Deploy health probe — confirms the Node process is up. No LLM or KB access. */
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    service: "cv-tailoring-api",
    status: "ok",
  });
}
