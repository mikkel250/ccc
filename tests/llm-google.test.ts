import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  describeGoogleEmptyContentResponse,
  dispatchProvider,
} from "../app/api/lib/llm";
import type { GoogleGenAI } from "@google/genai";

describe("describeGoogleEmptyContentResponse", () => {
  it("summarizes structure without candidate text or prompt content (PII-safe)", () => {
    const summary = describeGoogleEmptyContentResponse({
      candidates: [
        {
          index: 0,
          finishReason: "SAFETY",
          content: {
            parts: [{ text: "SECRET PERSON secret@example.com employment history" }],
          },
          safetyRatings: [{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", blocked: true }],
        },
      ],
      promptFeedback: {
        blockReason: "SAFETY",
        blockReasonMessage: "Prompt contained blocked terms",
        safetyRatings: [{ category: "HARM_CATEGORY_HARASSMENT", blocked: false }],
      },
      usageMetadata: {
        promptTokenCount: 1200,
        candidatesTokenCount: 0,
        totalTokenCount: 1200,
      },
      modelVersion: "gemini-2.5-pro",
      responseId: "resp-abc123",
    });

    assert.match(summary, /candidateCount=1/);
    assert.match(summary, /finishReasons=\[0:SAFETY\]/);
    assert.match(summary, /blockReason=SAFETY/);
    assert.match(summary, /promptTokens=1200/);
    assert.match(summary, /modelVersion=gemini-2\.5-pro/);
    assert.match(summary, /responseId=resp-abc123/);
    assert.doesNotMatch(summary, /SECRET PERSON|secret@example\.com|employment history/i);
    assert.doesNotMatch(summary, /blocked terms/i);
  });

  it("handles missing optional fields", () => {
    const summary = describeGoogleEmptyContentResponse({});
    assert.match(summary, /candidateCount=0/);
    assert.match(summary, /blockReason=null/);
    assert.match(summary, /usage=null/);
  });

  it("normalizes null, undefined, and non-object inputs without throwing", () => {
    assert.match(describeGoogleEmptyContentResponse(null), /responseType=null/);
    assert.match(
      describeGoogleEmptyContentResponse(undefined),
      /responseType=undefined/
    );
    assert.match(describeGoogleEmptyContentResponse("oops"), /responseType=string/);
    assert.match(
      describeGoogleEmptyContentResponse({ candidates: null }),
      /candidateCount=0/
    );
  });
});

describe("callGoogle via dispatchProvider", () => {
  const originalGoogleKey = process.env.GOOGLE_API_KEY;

  afterEach(() => {
    if (originalGoogleKey === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = originalGoogleKey;
  });

  it("wires systemInstruction, filters system turns, and maps user/model contents", async () => {
    process.env.GOOGLE_API_KEY = "test-google-key";
    type GoogleGenerateParams = {
      model?: string;
      contents?: Array<{ role: string; parts: Array<{ text: string }> }>;
      config?: {
        systemInstruction?: string;
        temperature?: number;
        maxOutputTokens?: number;
      };
    };
    const box: { current?: GoogleGenerateParams } = {};

    const googleClient = {
      models: {
        generateContent: async (params: GoogleGenerateParams) => {
          box.current = params;
          return {
            text: "google-ok",
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
            finishReason: "STOP",
          };
        },
      },
    } as unknown as GoogleGenAI;

    const response = await dispatchProvider(
      "google",
      [
        { role: "user", content: "hello" },
        { role: "assistant", content: "prior" },
        { role: "system", content: "must-not-appear-in-contents" },
        { role: "user", content: "revise" },
      ],
      "sys-instruction",
      {
        model: "google/gemini-2.5-flash",
        temperature: 0.2,
        maxTokens: 128,
        googleClient,
      }
    );

    assert.equal(response.content, "google-ok");
    assert.ok(box.current, "expected generateContent to be called");
    assert.equal(box.current.model, "gemini-2.5-flash");
    assert.equal(box.current.config?.systemInstruction, "sys-instruction");
    assert.equal(box.current.config?.temperature, 0.2);
    assert.equal(box.current.config?.maxOutputTokens, 128);
    assert.deepEqual(box.current.contents, [
      { role: "user", parts: [{ text: "hello" }] },
      { role: "model", parts: [{ text: "prior" }] },
      { role: "user", parts: [{ text: "revise" }] },
    ]);
  });

  it("throws when generateContent returns no text", async () => {
    process.env.GOOGLE_API_KEY = "test-google-key";
    const googleClient = {
      models: {
        generateContent: async () => ({
          text: "",
          candidates: null,
          usageMetadata: { promptTokenCount: 3 },
        }),
      },
    } as unknown as GoogleGenAI;

    await assert.rejects(
      () =>
        dispatchProvider(
          "google",
          [{ role: "user", content: "hi" }],
          "sys",
          { model: "google/gemini-2.5-flash", googleClient }
        ),
      /No text content in response from Google/
    );
  });
});
