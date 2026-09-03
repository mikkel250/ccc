import { describe, it, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { markdownToDocxBase64 } from "../app/api/lib/markdown-docx";
import type {
  JsonGroundingScore,
  JsonJdFitScore,
} from "../app/api/lib/eval-judge";
import {
  verifySmokePipeline,
  type SmokePipelineDeps,
} from "../app/api/lib/smoke-runner";

const MASTER = { name: "JANE EXAMPLE", summary: ["Evergreen"] };
const CURATED = { ...MASTER, summary: ["Tailored"] };
const JD = "Senior solutions engineer role";

function grounding(
  overrides: Partial<JsonGroundingScore> = {}
): JsonGroundingScore {
  return {
    score: 0.9,
    flaggedClaims: [],
    parseFailed: false,
    ...overrides,
  };
}

function jdFit(overrides: Partial<JsonJdFitScore> = {}): JsonJdFitScore {
  return {
    score: 4,
    reasoning: "strong fit",
    parseFailed: false,
    ...overrides,
  };
}

function baseOptions(deps: SmokePipelineDeps) {
  return {
    baseUrl: "http://localhost:3000",
    curationMode: "strict" as const,
    apiKey: "test-key",
    judgeModel: "test/judge",
    groundingMin: 0.7,
    jdFitMin: 3,
    deps,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("verifySmokePipeline", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("returns stage health when hello check fails", async () => {
    const fetchFn = mock.fn(async () => jsonResponse({ status: "down" }, 200));
    const result = await verifySmokePipeline(MASTER, JD, baseOptions({ fetchFn }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stage, "health");
    }
  });

  it("returns stage tailor with status on POST failure", async () => {
    const fetchFn = mock.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/hello")) {
        return jsonResponse({ status: "ok" });
      }
      return jsonResponse({ error: "unauthorized" }, 401);
    });
    const result = await verifySmokePipeline(MASTER, JD, baseOptions({ fetchFn }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stage, "tailor");
      assert.equal(result.status, 401);
    }
  });

  it("returns stage docx when cv is not a valid docx", async () => {
    const fetchFn = mock.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/hello")) {
        return jsonResponse({ status: "ok" });
      }
      return jsonResponse({
        cv: Buffer.from("not-a-docx").toString("base64"),
        curatedJson: CURATED,
        builderVersion: "test-builder",
        model: "test/model",
      });
    });
    const result = await verifySmokePipeline(MASTER, JD, baseOptions({ fetchFn }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stage, "docx");
    }
  });

  it("returns gatePassed false when judges parseFailed", async () => {
    const docx = await markdownToDocxBase64("# CV\n- bullet");
    const fetchFn = mock.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/hello")) {
        return jsonResponse({ status: "ok" });
      }
      return jsonResponse({
        cv: docx,
        curatedJson: CURATED,
        builderVersion: "test-builder",
        model: "test/model",
      });
    });
    const result = await verifySmokePipeline(
      MASTER,
      JD,
      baseOptions({
        fetchFn,
        scoreJsonGrounding: async () => grounding({ parseFailed: true }),
        scoreJsonJdFit: async () => jdFit({ parseFailed: true }),
      })
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.gatePassed, false);
      assert.ok(result.gateReasons.some((r) => /grounding/.test(r)));
      assert.ok(result.gateReasons.some((r) => /jd-fit/.test(r)));
    }
  });

  it("returns gatePassed true when scores meet mins", async () => {
    const docx = await markdownToDocxBase64("# CV\n- bullet");
    const fetchFn = mock.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/hello")) {
        return jsonResponse({ status: "ok" });
      }
      return jsonResponse({
        cv: docx,
        curatedJson: CURATED,
        builderVersion: "test-builder",
        model: "test/model",
      });
    });
    const result = await verifySmokePipeline(
      MASTER,
      JD,
      baseOptions({
        fetchFn,
        scoreJsonGrounding: async () => grounding(),
        scoreJsonJdFit: async () => jdFit(),
      })
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.gatePassed, true);
      assert.deepEqual(result.gateReasons, []);
      assert.equal(result.groundingScore, 0.9);
      assert.equal(result.jdFitScore, 4);
    }
  });

  it("returns gatePassed false for flagged claims and below-threshold scores", async () => {
    const docx = await markdownToDocxBase64("# CV\n- bullet");
    const fetchFn = mock.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/hello")) {
        return jsonResponse({ status: "ok" });
      }
      return jsonResponse({
        cv: docx,
        curatedJson: CURATED,
        builderVersion: "test-builder",
        model: "test/model",
      });
    });
    const result = await verifySmokePipeline(
      MASTER,
      JD,
      baseOptions({
        fetchFn,
        scoreJsonGrounding: async () =>
          grounding({ score: 0.2, flaggedClaims: ["invented metric"] }),
        scoreJsonJdFit: async () => jdFit({ score: 1 }),
      })
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.gatePassed, false);
      assert.ok(result.gateReasons.some((r) => /flaggedClaims/.test(r)));
      assert.ok(result.gateReasons.some((r) => /grounding score/.test(r)));
      assert.ok(result.gateReasons.some((r) => /jd-fit score/.test(r)));
    }
  });

  it("includes coverLetter in flexible mode", async () => {
    const docx = await markdownToDocxBase64("# CV\n- bullet");
    const fetchFn = mock.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/hello")) {
        return jsonResponse({ status: "ok" });
      }
      return jsonResponse({
        cv: docx,
        curatedJson: CURATED,
        builderVersion: "test-builder",
        model: "test/model",
        coverLetter: "Dear hiring manager,",
      });
    });
    const result = await verifySmokePipeline(MASTER, JD, {
      ...baseOptions({
        fetchFn,
        scoreJsonGrounding: async () => grounding(),
        scoreJsonJdFit: async () => jdFit(),
      }),
      curationMode: "flexible",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.coverLetter, "Dear hiring manager,");
    }
  });

  it("omits coverLetter in strict mode even when API returns one", async () => {
    const docx = await markdownToDocxBase64("# CV\n- bullet");
    const fetchFn = mock.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/hello")) {
        return jsonResponse({ status: "ok" });
      }
      return jsonResponse({
        cv: docx,
        curatedJson: CURATED,
        builderVersion: "test-builder",
        model: "test/model",
        coverLetter: "should be omitted",
      });
    });
    const result = await verifySmokePipeline(
      MASTER,
      JD,
      baseOptions({
        fetchFn,
        scoreJsonGrounding: async () => grounding(),
        scoreJsonJdFit: async () => jdFit(),
      })
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.coverLetter, undefined);
    }
  });
});
