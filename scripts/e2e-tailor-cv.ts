/**
 * End-to-end checks against a running server (default http://localhost:3000).
 * Requires API keys in .env.local for LLM calls.
 *
 * Usage: npx tsx scripts/e2e-tailor-cv.ts [baseUrl] [sampleName]
 * sampleName: startup-frontend | enterprise-fullstack | ai-ml (optional — runs all if omitted)
 */

import "dotenv/config";

const BASE_URL = process.argv[2] || process.env.E2E_BASE_URL || "http://localhost:3000";
const SAMPLE_FILTER = process.argv[3];

const SAMPLE_JDS = [
  {
    name: "startup-frontend",
    text: `Frontend Software Engineer — responsibilities: build React UI, requirements: 3+ years TypeScript, React, CSS. Must have: component architecture, performance optimization.`,
  },
  {
    name: "enterprise-fullstack",
    text: `Full Stack Engineer — responsibilities: design APIs and web apps, requirements: Node.js, PostgreSQL, React. Qualifications: 5 years experience, enterprise SaaS background preferred.`,
  },
  {
    name: "ai-ml",
    text: `AI Engineer — responsibilities: LLM integrations, RAG pipelines, requirements: Python, prompt engineering, observability. Nice to have: Langfuse, production ML systems.`,
  },
];

async function healthCheck(): Promise<boolean> {
  const res = await fetch(`${BASE_URL}/api/hello`);
  if (!res.ok) {
    console.error("Health check failed:", res.status);
    return false;
  }
  const data = await res.json();
  console.log("Health:", data);
  return data.status === "ok";
}

async function tailorCv(jd: string): Promise<{ ok: boolean; detail: string }> {
  const res = await fetch(`${BASE_URL}/api/tailor-cv`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jobDescription: jd,
      sessionId: `e2e-${Date.now()}`,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return { ok: false, detail: `HTTP ${res.status}: ${err}` };
  }

  const data = await res.json();
  if (!data.cv || typeof data.cv !== "string") {
    return { ok: false, detail: "Missing cv field in response" };
  }

  const buf = Buffer.from(data.cv, "base64");
  const isDocx = buf[0] === 0x50 && buf[1] === 0x4b;
  return {
    ok: isDocx,
    detail: `model=${data.model} bytes=${buf.length} docx=${isDocx}`,
  };
}

async function main() {
  const hasKey =
    process.env.GOOGLE_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY;

  if (!hasKey) {
    console.warn("Skipping LLM e2e: no API keys in environment");
    process.exit(0);
  }

  if (!(await healthCheck())) {
    process.exit(1);
  }

  const samples = SAMPLE_FILTER
    ? SAMPLE_JDS.filter((s) => s.name === SAMPLE_FILTER)
    : SAMPLE_JDS;

  if (SAMPLE_FILTER && samples.length === 0) {
    console.error(
      `Unknown sample "${SAMPLE_FILTER}". Choose: ${SAMPLE_JDS.map((s) => s.name).join(", ")}`
    );
    process.exit(1);
  }

  let failed = 0;
  for (const sample of samples) {
    console.log(`\n--- ${sample.name} ---`);
    const result = await tailorCv(sample.text);
    console.log(result.ok ? "PASS" : "FAIL", result.detail);
    if (!result.ok) failed++;
    // Avoid hammering free-tier per-minute token limits
    await new Promise((r) => setTimeout(r, 3000));
  }

  console.log(
    failed === 0
      ? "\nAll e2e JD samples passed."
      : `\n${failed} sample(s) failed.`
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
