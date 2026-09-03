import { describe, it, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateCvJson } from "../app/api/lib/cv-schema";
import { markdownToDocxBase64 } from "../app/api/lib/markdown-docx";
import {
  verifySmokePipeline,
  type SmokePipelineDeps,
} from "../app/api/lib/smoke-runner";

const curatedRaw: unknown = JSON.parse(
  readFileSync(
    join(process.cwd(), "tests/fixtures/curated-cv-valid.json"),
    "utf8"
  )
);
const curatedValidated = validateCvJson(curatedRaw);
if (!curatedValidated.ok) {
  throw new Error(`CURATED fixture invalid: ${curatedValidated.error}`);
}
const CURATED = curatedValidated.data;
const JD = "Senior solutions engineer role";

function baseOptions(deps: SmokePipelineDeps) {
  return {
    baseUrl: "http://localhost:3000",
    curationMode: "strict" as const,
    apiKey: "test-key",
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
    const result = await verifySmokePipeline(JD, baseOptions({ fetchFn }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stage, "health");
    }
  });

  it("returns stage health when hello HTTP status is not ok", async () => {
    const fetchFn = mock.fn(
      async () => new Response("unavailable", { status: 503 })
    );
    const result = await verifySmokePipeline(JD, baseOptions({ fetchFn }));
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
    const result = await verifySmokePipeline(JD, baseOptions({ fetchFn }));
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
    const result = await verifySmokePipeline(JD, baseOptions({ fetchFn }));
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
    const result = await verifySmokePipeline(JD, baseOptions({ fetchFn }));
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
    const result = await verifySmokePipeline(JD, baseOptions({ fetchFn }));
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
    const result = await verifySmokePipeline(JD, baseOptions({ fetchFn }));
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

  it("returns stage tailor when builderVersion is not a string", async () => {
    const docx = await markdownToDocxBase64("# CV\n- bullet");
    for (const builderVersion of [1, true, { v: "1" }, ["v1"]]) {
      const fetchFn = helloThen(() =>
        jsonResponse({
          cv: docx,
          curatedJson: CURATED,
          builderVersion,
          model: "test/model",
        })
      );
      const result = await verifySmokePipeline(
        JD,
        baseOptions({ fetchFn })
      );
      assert.equal(
        result.ok,
        false,
        `expected failure for builderVersion=${JSON.stringify(builderVersion)}`
      );
      if (!result.ok) {
        assert.equal(result.stage, "tailor");
        assert.equal(result.error, "Missing cv, curatedJson, or builderVersion");
      }
    }
  });

  it("POSTs tailor-cv with bearer auth, curation mode, and job description", async () => {
    const fetchFn = helloThen(() => jsonResponse({ error: "unauthorized" }, 401));
    const result = await verifySmokePipeline(JD, baseOptions({ fetchFn }));
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

  it("returns stage tailor when curatedJson fails CV schema validation", async () => {
    const docx = await markdownToDocxBase64("# CV\n- bullet");
    for (const curatedJson of [
      "not-an-object",
      ["array-not-cv"],
      { name: "incomplete" },
    ]) {
      const fetchFn = helloThen(() =>
        jsonResponse({
          cv: docx,
          curatedJson,
          builderVersion: "test-builder",
          model: "test/model",
        })
      );
      const result = await verifySmokePipeline(
        JD,
        baseOptions({ fetchFn })
      );
      assert.equal(
        result.ok,
        false,
        `expected schema failure for ${JSON.stringify(curatedJson)}`
      );
      if (!result.ok) {
        assert.equal(result.stage, "tailor");
        assert.match(result.error, /schema validation/i);
        assert.equal(result.status, 200);
      }
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
    const result = await verifySmokePipeline(JD, baseOptions({ fetchFn }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stage, "docx");
    }
  });

  it("succeeds without judge scores after valid tailor artifacts", async () => {
    const { fetchFn } = await okTailorFetch();
    const result = await verifySmokePipeline(JD, baseOptions({ fetchFn }));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.model, "test/model");
      assert.equal(result.builderVersion, "test-builder");
      assert.equal("gatePassed" in result, false);
      assert.equal("groundingScore" in result, false);
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
    const result = await verifySmokePipeline(JD, {
      ...baseOptions({ fetchFn }),
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
      JD,
      baseOptions({ fetchFn })
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.coverLetter, undefined);
    }
  });
});
