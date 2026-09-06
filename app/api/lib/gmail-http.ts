/**
 * Gmail REST JSON helper (injected fetch). No SDK.
 */
import type { FetchLike } from "./gmail-oauth";
import { getGmailHttpTimeoutMs } from "./gmail-config";

/** Non-array object from unknown JSON. Shared by list/message/draft parsers. */
export function gmailJsonObject(raw: unknown): object | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  return raw;
}

/** First header line only — strips CR/LF injection. */
export function sanitizeMimeHeaderValue(value: string): string {
  return value.split(/[\r\n]/)[0]!.trim();
}

export type GmailHttpResult =
  | { ok: true; body: unknown }
  | { ok: false; error: string };

export async function gmailFetchJson(params: {
  url: string;
  accessToken: string;
  fetchImpl: FetchLike;
  method?: string;
  jsonBody?: unknown;
}): Promise<GmailHttpResult> {
  const method = params.method ?? "GET";
  let response: Response;
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${params.accessToken}`,
    };
    if (params.jsonBody !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    response = await params.fetchImpl(params.url, {
      method,
      headers,
      signal: AbortSignal.timeout(getGmailHttpTimeoutMs()),
      ...(params.jsonBody !== undefined
        ? { body: JSON.stringify(params.jsonBody) }
        : {}),
    });
  } catch {
    return { ok: false, error: "Gmail API request failed" };
  }
  if (!response.ok) {
    return { ok: false, error: `Gmail API HTTP ${response.status}` };
  }
  try {
    return { ok: true, body: await response.json() };
  } catch {
    return { ok: false, error: "Gmail API response was not valid JSON" };
  }
}
