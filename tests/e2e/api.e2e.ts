import { test, expect } from "@playwright/test";

const tailorApiKey = process.env.TAILOR_API_KEY?.trim();

function authHeaders(): Record<string, string> {
  if (!tailorApiKey) {
    throw new Error("TAILOR_API_KEY must be set for authorized Playwright tailor tests");
  }
  return { Authorization: `Bearer ${tailorApiKey}` };
}

test("GET /api/hello returns 200 with service and status", async ({ request }) => {
  const response = await request.get("/api/hello");
  expect(response.status()).toBe(200);

  const json = await response.json();
  expect(json.service).toBe("cv-tailoring-api");
  expect(json.status).toBe("ok");
});

test("POST /api/tailor-cv without Authorization returns 401", async ({ request }) => {
  const response = await request.post("/api/tailor-cv", {
    data: { jobDescription: "Senior TypeScript engineer." },
  });
  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toBe("no-store");

  const json = await response.json();
  expect(json.error).toMatch(/unauthorized/i);
});

test("POST /api/tailor-cv with Bearer and missing body returns 400", async ({
  request,
}) => {
  test.skip(!tailorApiKey, "Set TAILOR_API_KEY to run authorized tailor e2e");

  const response = await request.post("/api/tailor-cv", {
    headers: authHeaders(),
    data: {},
  });
  expect(response.status()).toBe(400);

  const json = await response.json();
  expect(json.error).toMatch(/required/i);
});

test("POST /api/tailor-cv with Bearer and empty jobDescription returns 400", async ({
  request,
}) => {
  test.skip(!tailorApiKey, "Set TAILOR_API_KEY to run authorized tailor e2e");

  const response = await request.post("/api/tailor-cv", {
    headers: authHeaders(),
    data: { jobDescription: "" },
  });
  expect(response.status()).toBe(400);

  const json = await response.json();
  expect(typeof json.error).toBe("string");
});

test("GET /api/tailor-cv returns 405", async ({ request }) => {
  const response = await request.get("/api/tailor-cv");
  expect(response.status()).toBe(405);

  const json = await response.json();
  expect(json.error).toMatch(/method not allowed/i);
});

test("POST /api/tailor-cv happy path (guarded)", async ({ request }) => {
  test.skip(
    !process.env.RUN_E2E_LLM_TESTS,
    "Set RUN_E2E_LLM_TESTS=true to run"
  );
  test.skip(!tailorApiKey, "Set TAILOR_API_KEY to run authorized tailor e2e");

  const response = await request.post("/api/tailor-cv", {
    headers: authHeaders(),
    data: {
      jobDescription:
        "Senior TypeScript engineer. Must have: React, Node, TypeScript.",
    },
  });
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");

  const json = await response.json();
  expect(typeof json.cv).toBe("string");
  expect(json.cv.length).toBeGreaterThan(0);

  const magic = Buffer.from(json.cv, "base64").slice(0, 2).toString();
  expect(magic).toBe("PK");
});
