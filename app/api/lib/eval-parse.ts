/** Shared LLM JSON parsing helpers for eval judge and extract modules. */

export function extractStructuredJson(llmResponse: string): unknown {
  const trimmed = llmResponse.trim();
  if (!trimmed) {
    throw new Error("empty response — cannot parse JSON");
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1]!.trim() : trimmed;

  const jsonStart = candidate.indexOf("{");
  const jsonEnd = candidate.lastIndexOf("}");
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    const jsonSlice = candidate.slice(jsonStart, jsonEnd + 1);
    return JSON.parse(jsonSlice);
  }

  return JSON.parse(candidate);
}

/**
 * PII-safe diagnostic for curator/judge JSON parse failures.
 * Never includes response body — only length/shape/finish metadata.
 */
export function describeJsonParseFailure(params: {
  content: string;
  finishReason?: string | null;
  completionTokens?: number;
  parseError: unknown;
}): string {
  const content = params.content ?? "";
  const trimmed = content.trimStart();
  const parseError =
    params.parseError instanceof Error
      ? params.parseError.message
      : String(params.parseError);
  return [
    `len=${content.length}`,
    `finish=${params.finishReason ?? "null"}`,
    `completionTokens=${params.completionTokens ?? "?"}`,
    `startsBrace=${trimmed.startsWith("{")}`,
    `hasFence=${/```/.test(content)}`,
    `parseError=${parseError}`,
  ].join(" ");
}

export function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}
