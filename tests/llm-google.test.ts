import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { GoogleGenAI } from "@google/genai";
import { dispatchProvider } from "../app/api/lib/llm";

describe("callGoogle via dispatchProvider", () => {
  it("passes system prompt via systemInstruction and user content separately", async () => {
    let capturedParams: Record<string, unknown> | undefined;
    const mockClient = {
      models: {
        generateContent: async (params: Record<string, unknown>) => {
          capturedParams = params;
          return {
            text: "google response",
            usage: {
              promptTokens: 10,
              completionTokens: 5,
              totalTokens: 15,
            },
            finishReason: "STOP",
          };
        },
      },
    } as unknown as GoogleGenAI;

    process.env.GOOGLE_API_KEY = "test-key";
    const systemPrompt = "You are a CV curator. Master CV: { ... }";
    const userContent = "Job description in nonce tags";

    const response = await dispatchProvider(
      "google",
      [{ role: "user", content: userContent }],
      systemPrompt,
      {
        model: "google/gemini-2.5-pro",
        googleClient: mockClient,
      }
    );

    assert.equal(response.content, "google response");
    assert.ok(capturedParams);

    const config = capturedParams.config as Record<string, unknown>;
    assert.equal(config.systemInstruction, systemPrompt);

    const contents = capturedParams.contents as Array<{
      role?: string;
      parts?: Array<{ text?: string }>;
    }>;
    assert.ok(Array.isArray(contents));
    assert.equal(contents.length, 1);
    assert.equal(contents[0].role, "user");
    assert.equal(contents[0].parts?.[0]?.text, userContent);

    const contentsJson = JSON.stringify(contents);
    assert.ok(
      !contentsJson.includes(systemPrompt),
      "system prompt must not appear in contents"
    );
  });

  it("maps assistant history to model role for multi-turn contents", async () => {
    let capturedParams: Record<string, unknown> | undefined;
    const mockClient = {
      models: {
        generateContent: async (params: Record<string, unknown>) => {
          capturedParams = params;
          return {
            text: "follow-up",
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
            finishReason: "STOP",
          };
        },
      },
    } as unknown as GoogleGenAI;

    process.env.GOOGLE_API_KEY = "test-key";

    await dispatchProvider(
      "google",
      [
        { role: "user", content: "first" },
        { role: "assistant", content: "reply" },
        { role: "user", content: "second" },
      ],
      "System",
      { model: "google/gemini-2.5-pro", googleClient: mockClient }
    );

    const contents = capturedParams?.contents as Array<{ role?: string }>;
    assert.deepEqual(
      contents.map((entry) => entry.role),
      ["user", "model", "user"]
    );
  });
});
