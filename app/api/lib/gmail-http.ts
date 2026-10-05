/**
 * Gmail REST JSON helper (injected fetch). No SDK.
 */
import { gmailAbortAfter, type FetchLike } from "./gmail-oauth";
import { getGmailHttpTimeoutMs } from "./gmail-config";

function combineAbortSignals(first: AbortSignal, second: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const abort = () => {
    controller.abort();
  };
  if (first.aborted || second.aborted) {
    controller.abort();
    return controller.signal;
  }
  first.addEventListener("abort", abort, { once: true });
  second.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

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
  signal?: AbortSignal;
}): Promise<GmailHttpResult> {
  const method = params.method ?? "GET";
  const deadline = gmailAbortAfter(getGmailHttpTimeoutMs());
  const signal = params.signal
    ? combineAbortSignals(deadline.signal, params.signal)
    : deadline.signal;
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${params.accessToken}`,
    };
    if (params.jsonBody !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    const response = await params.fetchImpl(params.url, {
      method,
      headers,
      signal,
      ...(params.jsonBody !== undefined
        ? { body: JSON.stringify(params.jsonBody) }
        : {}),
    });
    if (!response.ok) {
      return { ok: false, error: `Gmail API HTTP ${response.status}` };
    }
    try {
      return { ok: true, body: await response.json() };
    } catch {
      if (signal.aborted) {
        return { ok: false, error: "Gmail API request failed" };
      }
      return { ok: false, error: "Gmail API response was not valid JSON" };
    }
  } catch {
    return { ok: false, error: "Gmail API request failed" };
  } finally {
    deadline.cancel();
  }
}
