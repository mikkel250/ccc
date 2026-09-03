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

function helloThen(
  tailor: (
    input: RequestInfo | URL,
    init?: RequestInit
  ) => Response | Promise<Response>
) {
  return mock.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/api/hello")) {
      return jsonResponse({ status: "ok" });
    }
    return tailor(input, init);
  });
}

async function okTailorFetch() {
  const docx = await markdownToDocxBase64("# CV\n- bullet");
  return {
    fetchFn: helloThen(() =>
      jsonResponse({
        cv: docx,
        curatedJson: CURATED,
        builderVersion: "test-builder",
        model: "test/model",
      })
    ),
  };
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

  it("returns stage health when hello HTTP status is not ok", async () => {
    const fetchFn = mock.fn(
      async () => new Response("unavailable", { status: 503 })
    );
    const result = await verifySmokePipeline(MASTER, JD, baseOptions({ fetchFn }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stage, "health");
      assert.equal(result.error, "Health check failed: 503");
      assert.equal(result.status, 503);
    }
  });

  it("returns stage health when hello fetch rejects", async () => {
    const fetchFn = mock.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const result = await verifySmokePipeline(MASTER, JD, baseOptions({ fetchFn }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stage, "health");
      assert.equal(result.error, "fetch failed");
      assert.equal(result.status, undefined);
    }
  });

  it("returns stage health when hello json() rejects", async () => {
    const fetchFn = mock.fn(async () => {
      const res = jsonResponse({ status: "ok" });
      return Object.assign(res, {
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      });
    });
    const result = await verifySmokePipeline(MASTER, JD, baseOptions({ fetchFn }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stage, "health");
      assert.equal(result.error, "Health check returned non-JSON body");
      assert.equal(result.status, 200);
    }
  });

  it("returns stage health when hello JSON is not an object", async () => {
    for (const body of [null, [], "ok", 1]) {
      const fetchFn = mock.fn(async () => jsonResponse(body));
      const result = await verifySmokePipeline(
        MASTER,
        JD,
        baseOptions({ fetchFn })
      );
      assert.equal(
        result.ok,
        false,
        `expected health failure for ${JSON.stringify(body)}`
      );
      if (!result.ok) {
        assert.equal(result.stage, "health");
        assert.equal(result.error, "Health check status is undefined");
        assert.equal(result.status, 200);
      }
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

  it("returns stage tailor when tailor fetch rejects", async () => {
    const fetchFn = helloThen(() => {
      throw new TypeError("connect ECONNREFUSED");
    });
    const result = await verifySmokePipeline(MASTER, JD, baseOptions({ fetchFn }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stage, "tailor");
      assert.equal(result.error, "connect ECONNREFUSED");
      assert.equal(result.status, undefined);
    }
  });

  it("returns stage tailor when tailor json() rejects", async () => {
    const fetchFn = helloThen(() => {
      const res = jsonResponse({ cv: "x" });
      return Object.assign(res, {
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      });
    });
    const result = await verifySmokePipeline(MASTER, JD, baseOptions({ fetchFn }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stage, "tailor");
      assert.equal(result.error, "HTTP 200: non-JSON body");
      assert.equal(result.status, 200);
    }
  });

  it("returns stage tailor when tailor JSON is not an object", async () => {
    for (const body of [null, [], "oops", 1]) {
      const fetchFn = helloThen(() => jsonResponse(body));
      const result = await verifySmokePipeline(
        MASTER,
        JD,
        baseOptions({ fetchFn })
      );
      assert.equal(
        result.ok,
        false,
        `expected tailor failure for ${JSON.stringify(body)}`
      );
      if (!result.ok) {
        assert.equal(result.stage, "tailor");
        assert.equal(result.error, "Missing cv, curatedJson, or builderVersion");
        assert.equal(result.status, 200);
      }
    }
  });

  it("returns stage tailor when cv, curatedJson, or builderVersion is missing", async () => {
    const docx = await markdownToDocxBase64("# CV\n- bullet");
    const complete = {
      cv: docx,
      curatedJson: CURATED,
      builderVersion: "test-builder",
      model: "test/model",
    };
    for (const key of ["cv", "curatedJson", "builderVersion"] as const) {
      const { [key]: _omitted, ...body } = complete;
      const fetchFn = helloThen(() => jsonResponse(body));
      const result = await verifySmokePipeline(
        MASTER,
        JD,
        baseOptions({ fetchFn })
      );
      assert.equal(result.ok, false, `expected failure when ${key} missing`);
      if (!result.ok) {
        assert.equal(result.stage, "tailor");
        assert.equal(result.error, "Missing cv, curatedJson, or builderVersion");
        assert.equal(result.status, 200);
      }
    }
  });

  it("POSTs tailor-cv with bearer auth, curation mode, and job description", async () => {
    const fetchFn = helloThen(() => jsonResponse({ error: "unauthorized" }, 401));
    const result = await verifySmokePipeline(MASTER, JD, baseOptions({ fetchFn }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stage, "tailor");
    }
    assert.equal(fetchFn.mock.calls.length, 2);
    const tailorCall = fetchFn.mock.calls[1];
    assert.equal(
      String(tailorCall?.arguments[0]),
      "http://localhost:3000/api/tailor-cv"
    );
    const init = tailorCall?.arguments[1] as RequestInit;
    assert.equal(init.method, "POST");
    const headers = init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer test-key");
    assert.equal(headers["Content-Type"], "application/json");
    const body = JSON.parse(String(init.body)) as {
      jobDescription: string;
      curationMode: string;
      sessionId: string;
    };
    assert.equal(body.jobDescription, JD);
    assert.equal(body.curationMode, "strict");
    assert.match(body.sessionId, /^smoke-\d+$/);
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

  it("returns stage judges when a judge throws", async () => {
    const { fetchFn } = await okTailorFetch();
    let jdFitCalled = false;
    const result = await verifySmokePipeline(
      MASTER,
      JD,
      baseOptions({
        fetchFn,
        scoreJsonGrounding: async () => {
          throw new Error("grounding transport failed");
        },
        scoreJsonJdFit: async () => {
          jdFitCalled = true;
          return jdFit();
        },
      })
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stage, "judges");
      assert.equal(result.error, "grounding transport failed");
      assert.equal("gatePassed" in result, false);
    }
    assert.equal(jdFitCalled, false);
  });

  it("enforces groundingMin when jdFitMin is omitted", async () => {
    const { fetchFn } = await okTailorFetch();
    const result = await verifySmokePipeline(MASTER, JD, {
      ...baseOptions({
        fetchFn,
        scoreJsonGrounding: async () => grounding({ score: 0.8 }),
        scoreJsonJdFit: async () => jdFit({ score: 5 }),
      }),
      groundingMin: 0.9,
      jdFitMin: undefined,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.gatePassed, false);
      assert.ok(result.gateReasons.some((r) => /grounding score/.test(r)));
      assert.equal(
        result.gateReasons.some((r) => /jd-fit score/.test(r)),
        false
      );
    }
  });

  it("enforces jdFitMin when groundingMin is omitted", async () => {
    const { fetchFn } = await okTailorFetch();
    const result = await verifySmokePipeline(MASTER, JD, {
      ...baseOptions({
        fetchFn,
        scoreJsonGrounding: async () => grounding({ score: 0.9 }),
        scoreJsonJdFit: async () => jdFit({ score: 3 }),
      }),
      groundingMin: undefined,
      jdFitMin: 4,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.gatePassed, false);
      assert.ok(result.gateReasons.some((r) => /jd-fit score/.test(r)));
      assert.equal(
        result.gateReasons.some((r) => /grounding score/.test(r)),
        false
      );
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
