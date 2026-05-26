import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    service: "cv-tailoring-api",
    status: "ok",
  });
}
