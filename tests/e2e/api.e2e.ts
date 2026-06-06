import { test, expect } from "@playwright/test";

test("GET /api/hello returns 200 with service and status", async ({ request }) => {
  const response = await request.get("/api/hello");
  expect(response.status()).toBe(200);

  const json = await response.json();
  expect(json.service).toBe("cv-tailoring-api");
  expect(json.status).toBe("ok");
});

test("POST /api/tailor-cv with missing body returns 400", async ({ request }) => {
  const response = await request.post("/api/tailor-cv", {
    data: {},
  });
  expect(response.status()).toBe(400);

  const json = await response.json();
  expect(json.error).toMatch(/required/i);
});

test("POST /api/tailor-cv with empty jobDescription returns 400", async ({
  request,
}) => {
  const response = await request.post("/api/tailor-cv", {
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

  const response = await request.post("/api/tailor-cv", {
    data: {
      jobDescription:
        "Senior TypeScript engineer. Must have: React, Node, TypeScript.",
    },
  });
  expect(response.status()).toBe(200);

  const json = await response.json();
  expect(typeof json.cv).toBe("string");
  expect(json.cv.length).toBeGreaterThan(0);

  const magic = Buffer.from(json.cv, "base64").slice(0, 2).toString();
  expect(magic).toBe("PK");
});
