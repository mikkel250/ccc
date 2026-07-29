/**
 * CV tailoring pipeline — orchestrates all 10 steps from auth through DOCX generation.
 *
 * Returns a discriminated union: the route handler maps to HTTP status codes.
 * Extracted from route.ts so the upcoming critique-revise loop can be
 * unit-tested without HTTP mocking.
 */
import { isIP } from "node:net";
import type { NextRequest } from "next/server";
import { validateTailorCvBody } from "./tailor-cv-validation";
import {
  getEnvBoolean,
  getEnvNumber,
  getTailorModel,
  getTailorReasoningEffort,
  type ReasoningEffort,
} from "../../../lib/env";
import { RateLimitError, ServiceError } from "./errors";
import { getConfiguredTailorApiKey } from "./tailor-auth";
import { hashTailorApiKeyForRateLimit, getRateLimitConfig } from "./rate-limit";
import {
  getTailorRequestMaxBytes,
  getTailorResponseMaxBytes,
} from "./cv-schema";
import { CURATOR_LANGFUSE_PROMPT_NAME } from "./curator-prompt";
import { isFlexibleWrapper, flexibleCoverLetter } from "./curation-mode";
import type { CurationMode } from "./curation-mode";
import { critiqueCvDraft } from "./adversarial-judge";
import { withDeadline } from "./with-deadline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TailorResponseBody {
  cv: string;
  curatedJson: unknown;
  builderVersion: string;
  curationMode: CurationMode;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  remaining: number;
  resetTime: number;
  /** Present only for flexible mode — cover letter as markdown. */
  coverLetter?: string;
}

export type TailorPipelineResult =
  | { ok: true; body: TailorResponseBody }
  | {
      ok: false;
      error: string;
      status: 400 | 401 | 413 | 422 | 429 | 503;
      /** Present for rate-limit 429s so the route can set Retry-After. */
      resetTime?: number;
      /** Present for rate-limit 429s so clients can display quota state. */
      remaining?: number;
    };

// ---------------------------------------------------------------------------
// Helpers (moved from route.ts)
// ---------------------------------------------------------------------------

/** Reject values too long to be valid IP addresses (IPv6 with zone ID ≤ 55 chars). */
function isValidIp(value: string): boolean {
  if (value.length > 55) return false;
  return isIP(value) !== 0;
}

/** Max rightmost x-forwarded-for entries to examine before giving up. */
const MAX_XFF_ENTRIES = Math.max(1, getEnvNumber("TAILOR_MAX_XFF_ENTRIES", 5));

function parseClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded?.trim()) return "unknown";

  const entries = forwarded.split(",");
  const start = Math.max(0, entries.length - MAX_XFF_ENTRIES);
  for (let i = entries.length - 1; i >= start; i--) {
    const entry = entries[i]!.trim();
    if (!entry) continue;
    return isValidIp(entry) ? entry : "unknown";
  }
  return "unknown";
}

async function readRequestBodyCapped(
  request: NextRequest,
  maxBytes: number
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      return { ok: false, error: "Request body too large" };
    }
  }

  const reader = request.body?.getReader();
  if (!reader) {
    try {
      const text = await request.text();
      if (Buffer.byteLength(text, "utf8") > maxBytes) {
        return { ok: false, error: "Request body too large" };
      }
      return { ok: true, text };
    } catch {
      return { ok: false, error: "Invalid request body" };
    }
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, error: "Request body too large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, error: "Invalid request body" };
  }

  return { ok: true, text: Buffer.concat(chunks).toString("utf8") };
}

// ---------------------------------------------------------------------------
// Pipeline deps shape
// ---------------------------------------------------------------------------

export interface TailorPipelineDeps {
  authenticateTailorRequest: (
    authorization: string | null
  ) => { ok: true; mode: string } | { ok: false; error: string; status: 401 };
  checkRateLimit: (
    phase: string,
    ipAddress: string,
    secretBucketKey: string
  ) => Promise<{
    allowed: boolean;
    remaining: number;
    resetTime: number;
    message?: string;
  }>;
  requireMasterCv: () => Record<string, unknown>;
  getCuratorPrompt: (mode?: CurationMode) => Promise<{
    systemPrompt: string;
    langfusePrompt?: {
      name: string;
      version: number;
      isFallback?: boolean;
    } | null;
  }>;
  applyCurationModePolicy: (prompt: string, mode: CurationMode) => string;
  compileCuratorPrompt: (
    prompt: string,
    masterCv: Record<string, unknown>
  ) => { ok: true; systemPrompt: string } | { ok: false; error: string };
  buildCuratorUserMessage: (
    jobDescription: string,
    curationMode: CurationMode
  ) => string;
  chat: (
    messages: Array<{ role: "user"; content: string }>,
    systemPrompt: string,
    options: {
      model: string;
      langfusePrompt: {
        name: string;
        version: number;
        isFallback?: boolean;
      };
      source: string;
      reasoningEffort?: ReasoningEffort;
      signal?: AbortSignal;
    }
  ) => Promise<{
    content: string;
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    model: string;
    finishReason: string | null;
  }>;
  isLlmServiceError: (message: string) => boolean;
  extractStructuredJson: (text: string) => unknown;
  validateCvJson: (
    data: unknown
  ) =>
    | { ok: true; data: unknown }
    | { ok: false; error: string };
  assertCuratedJsonSize: (
    data: unknown
  ) => { ok: true } | { ok: false; error: string };
  buildJsonDocxBase64: (
    curated: unknown
  ) => Promise<
    | { ok: true; base64: string; builderVersion: string }
    | { ok: false; error: string }
  >;
  sanitizeForResponse: (data: unknown) => unknown;
}

/**
 * Adapts pipeline `deps.chat` for the adversarial judge: default model/source
 * and Langfuse prompt fallbacks without inlining that wiring at the call site.
 */
function buildJudgeChatAdapter(
  chat: TailorPipelineDeps["chat"],
  langfusePrompt: {
    name: string;
    version: number;
    isFallback?: boolean;
  } | null | undefined
) {
  return (
    msgs: Parameters<TailorPipelineDeps["chat"]>[0] | Array<{ role?: string; content: string }>,
    sysPrompt: string,
    opts?: {
      model?: string;
      source?: string;
      langfusePrompt?: {
        name: string;
        version: number;
        isFallback?: boolean;
      } | null;
      signal?: AbortSignal;
    }
  ) =>
    chat(msgs as Array<{ role: "user"; content: string }>, sysPrompt, {
      model: opts?.model ?? getTailorModel(),
      source: opts?.source ?? "tailor-cv-judge",
      signal: opts?.signal,
      langfusePrompt: opts?.langfusePrompt
        ? {
            name: opts.langfusePrompt.name,
            version: opts.langfusePrompt.version,
            isFallback: opts.langfusePrompt.isFallback ?? false,
          }
        : langfusePrompt
          ? {
              name: langfusePrompt.name,
              version: langfusePrompt.version,
              isFallback: langfusePrompt.isFallback ?? false,
            }
          : {
              name: CURATOR_LANGFUSE_PROMPT_NAME,
              version: 0,
              isFallback: true,
            },
    });
}

type UsageTotals = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

function addUsage(a: UsageTotals, b: UsageTotals): UsageTotals {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

async function withCallTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  return withDeadline(run, { timeoutMs, label });
}

/** Whether revise output matches the step-8 structured contract for this mode. */
function isValidRevisePayload(
  parsed: unknown,
  curationMode: CurationMode
): boolean {
  if (curationMode === "flexible") {
    return isFlexibleWrapper(parsed);
  }
  return parsed !== null && typeof parsed === "object";
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export async function buildTailorResponse(
  deps: TailorPipelineDeps,
  request: NextRequest
): Promise<TailorPipelineResult> {
  // 1. Auth
  const auth = deps.authenticateTailorRequest(
    request.headers.get("authorization")
  );
  if (!auth.ok) {
    return { ok: false, error: auth.error, status: auth.status };
  }

  // 2. IP resolution
  const ipAddress = parseClientIp(request);
  if (ipAddress === "unknown") {
    return { ok: false, error: "Cannot determine client IP", status: 400 };
  }

  // 3. Rate limit
  const configuredKey = getConfiguredTailorApiKey();
  const secretBucketKey = configuredKey
    ? hashTailorApiKeyForRateLimit(configuredKey)
    : hashTailorApiKeyForRateLimit(`bypass:${auth.mode}`);

  let rateLimit: Awaited<ReturnType<typeof deps.checkRateLimit>>;
  try {
    rateLimit = await deps.checkRateLimit(
      "pre-body",
      ipAddress,
      secretBucketKey
    );
  } catch (error: unknown) {
    if (error instanceof RateLimitError) {
      return {
        ok: false,
        error: error.message,
        status: 429,
        resetTime: Date.now() + getRateLimitConfig().windowMs,
        remaining: 0,
      };
    }
    if (error instanceof ServiceError) {
      return { ok: false, error: error.message, status: 503 };
    }
    throw error;
  }
  if (!rateLimit.allowed) {
    return {
      ok: false,
      error: rateLimit.message || "Rate limit exceeded",
      status: 429,
      resetTime: rateLimit.resetTime,
      remaining: rateLimit.remaining,
    };
  }

  // 4. Body cap
  const maxRequestBytes = getTailorRequestMaxBytes();
  const bodyRead = await readRequestBodyCapped(request, maxRequestBytes);
  if (!bodyRead.ok) {
    const status =
      bodyRead.error === "Request body too large" ? 413 : 400;
    return { ok: false, error: bodyRead.error, status };
  }

  // 5. JSON parse + validate
  let body: unknown;
  try {
    body = JSON.parse(bodyRead.text);
  } catch {
    return { ok: false, error: "Invalid JSON in request body", status: 400 };
  }

  const validated = validateTailorCvBody(body, `ip:${ipAddress}`);
  if (!validated.ok) {
    return { ok: false, error: validated.error, status: 400 };
  }

  const { jobDescription, curationMode } = validated;

  // 6. Prompt construction
  const masterCv = deps.requireMasterCv();
  const { systemPrompt: promptText, langfusePrompt } =
    await deps.getCuratorPrompt(curationMode);
  const modePrompt = deps.applyCurationModePolicy(promptText, curationMode);
  const compiled = deps.compileCuratorPrompt(modePrompt, masterCv);
  if (!compiled.ok) {
    return { ok: false, error: compiled.error, status: 503 };
  }
  const systemPrompt = compiled.systemPrompt;
  const userContent = deps.buildCuratorUserMessage(
    jobDescription,
    curationMode
  );

  // 7. LLM call — first draft
  const firstDraftResponse = await deps.chat(
    [{ role: "user" as const, content: userContent }],
    systemPrompt,
    {
      model: getTailorModel(),
      reasoningEffort: getTailorReasoningEffort(),
      langfusePrompt: langfusePrompt ?? {
        name: CURATOR_LANGFUSE_PROMPT_NAME,
        version: 0,
        isFallback: true,
      },
      source: "tailor-cv-curator",
    }
  );

  let finalContent = firstDraftResponse.content;
  let finalModel = firstDraftResponse.model;
  let finalUsage = firstDraftResponse.usage;

  // 7a. Critique-revise loop (opt-in; off by default until rate/latency controls are sized)
  const critiqueEnabled = getEnvBoolean("CRITIQUE_REVISE_ENABLED", false);

  if (critiqueEnabled) {
    const budgetMs = getEnvNumber("CRITIQUE_REVISE_BUDGET_MS", 45_000);
    const callTimeoutMs = getEnvNumber("CRITIQUE_REVISE_CALL_TIMEOUT_MS", 20_000);
    const budgetDeadline = Date.now() + budgetMs;

    // Parse first draft to pass to judge
    let firstDraftParsed: unknown;
    let curatedForJudge: unknown;
    let coverLetterForJudge: string | undefined;
    try {
      firstDraftParsed = deps.extractStructuredJson(firstDraftResponse.content);
      if (curationMode === "flexible") {
        if (isFlexibleWrapper(firstDraftParsed)) {
          curatedForJudge = firstDraftParsed.curated_cv;
          coverLetterForJudge = flexibleCoverLetter(firstDraftParsed);
        } else {
          curatedForJudge = firstDraftParsed;
        }
      } else {
        curatedForJudge = firstDraftParsed;
      }
    } catch {
      // First draft is unparseable — skip critique, let step 8 handle the error
      curatedForJudge = null;
    }

    const remainingBeforeJudge = budgetDeadline - Date.now();
    if (!curatedForJudge) {
      // skip — step 8 handles unparseable draft
    } else if (remainingBeforeJudge <= 0) {
      console.error(
        "Critique-revise budget exhausted before judge — keeping first draft"
      );
    } else {
      try {
        const judgeTimeoutMs = Math.min(callTimeoutMs, remainingBeforeJudge);
        const critique = await critiqueCvDraft(
          {
            curatedCv: curatedForJudge,
            jobDescription,
            curationMode,
            coverLetter: coverLetterForJudge,
            masterCv,
          },
          // Pass deps.chat so tests can mock the judge's LLM call
          {
            chat: buildJudgeChatAdapter(deps.chat, langfusePrompt),
            timeoutMs: judgeTimeoutMs,
          }
        );

        if (critique.ok) {
          // Attribute judge tokens before revise so a revise failure still
          // reports draft + critique usage via the outer catch path.
          finalUsage = addUsage(firstDraftResponse.usage, critique.usage);

          const remainingBeforeRevise = budgetDeadline - Date.now();
          if (remainingBeforeRevise <= 0) {
            console.error(
              "Critique-revise budget exhausted before revise — keeping first draft"
            );
          } else {
            // Build revise user message
            const reviseUserMessage = [
              "You produced a first draft of a curated CV. An adversarial judge reviewed it",
              "and provided the following critique. Revise the CV to address the critique",
              "while staying grounded in the master CV.",
              "",
              "CRITICAL: Do NOT invent facts to satisfy the judge's critique.",
              "If a gap exists, leave it or address it honestly in the cover letter.",
              "",
              "## First Draft",
              JSON.stringify(firstDraftParsed, null, 2),
              "",
              "## Judge Critique",
              JSON.stringify(critique.critique, null, 2),
              "",
              "## Original Job Description",
              jobDescription,
              "",
              "Please produce the revised output in the same format as your first draft.",
            ].join("\n");

            const reviseTimeoutMs = Math.min(
              callTimeoutMs,
              remainingBeforeRevise
            );
            const reviseResponse = await withCallTimeout(
              (signal) =>
                deps.chat(
                  [{ role: "user" as const, content: reviseUserMessage }],
                  systemPrompt,
                  {
                    model: getTailorModel(),
                    reasoningEffort: getTailorReasoningEffort(),
                    langfusePrompt: langfusePrompt ?? {
                      name: CURATOR_LANGFUSE_PROMPT_NAME,
                      version: 0,
                      isFallback: true,
                    },
                    source: "tailor-cv-revise",
                    signal,
                  }
                ),
              reviseTimeoutMs,
              "Revise call"
            );

            // Adopt the revise only if it matches the step-8 structured contract
            // and passes schema + size checks. Otherwise keep the first draft.
            let reviseParseOk = false;
            try {
              const reviseParsed = deps.extractStructuredJson(
                reviseResponse.content
              );
              if (!isValidRevisePayload(reviseParsed, curationMode)) {
                console.error(
                  "Revise output failed structured contract — keeping first draft"
                );
              } else {
                const curatedRaw =
                  curationMode === "flexible" &&
                  isFlexibleWrapper(reviseParsed)
                    ? reviseParsed.curated_cv
                    : reviseParsed;
                const schemaResult = deps.validateCvJson(curatedRaw);
                if (!schemaResult.ok) {
                  console.error(
                    "Revise output failed schema validation — keeping first draft"
                  );
                } else {
                  const sizeResult = deps.assertCuratedJsonSize(
                    schemaResult.data
                  );
                  if (!sizeResult.ok) {
                    console.error(
                      "Revise output failed curated JSON size check — keeping first draft"
                    );
                  } else {
                    reviseParseOk = true;
                  }
                }
              }
            } catch {
              console.error(
                "Revise output was not valid JSON — keeping first draft"
              );
            }

            if (reviseParseOk) {
              finalContent = reviseResponse.content;
              finalModel = reviseResponse.model;
              // critique.usage already in finalUsage; add revise only.
              finalUsage = addUsage(finalUsage, reviseResponse.usage);
            }
          }
        } else {
          console.error(
            "Adversarial judge failed, returning first draft:",
            critique.error
          );
          if (critique.usage) {
            finalUsage = addUsage(firstDraftResponse.usage, critique.usage);
          }
        }
      } catch (error: unknown) {
        console.error(
          "Critique-revise loop failed, returning first draft:",
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  // 8. Extract + schema validate + size check
  let curatedRaw: unknown;
  let coverLetter: string | undefined;
  try {
    const parsed = deps.extractStructuredJson(finalContent);
    if (curationMode === "flexible") {
      if (!isFlexibleWrapper(parsed)) {
        console.error("Curator output missing curated_cv in flexible wrapper");
        return {
          ok: false,
          error: "Curator output missing curated_cv in flexible wrapper",
          status: 422,
        };
      }
      curatedRaw = parsed.curated_cv;
      coverLetter = flexibleCoverLetter(parsed);
    } else {
      curatedRaw = parsed;
    }
  } catch {
    console.error("Curator output was not valid JSON");
    return { ok: false, error: "Curator output was not valid JSON", status: 422 };
  }

  const schemaResult = deps.validateCvJson(curatedRaw);
  if (!schemaResult.ok) {
    // Path-only Ajv detail (no instance values / PII) — needed to diagnose live smoke 422s.
    console.error("Curator output failed schema validation:", schemaResult.error);
    return {
      ok: false,
      error: "Curator output failed schema validation",
      status: 422,
    };
  }

  const sizeResult = deps.assertCuratedJsonSize(schemaResult.data);
  if (!sizeResult.ok) {
    return { ok: false, error: sizeResult.error, status: 422 };
  }

  // 9. Sanitize + DOCX
  const sanitized = deps.sanitizeForResponse(schemaResult.data);

  const built = await deps.buildJsonDocxBase64(schemaResult.data);
  if (!built.ok) {
    console.error("Docx builder failed after valid curated JSON");
    return {
      ok: false,
      error: "Failed to render CV document",
      status: 422,
    };
  }

  // 10. Build response body
  const responseBody: TailorResponseBody = {
    cv: built.base64,
    curatedJson: sanitized,
    builderVersion: built.builderVersion,
    curationMode,
    model: finalModel,
    usage: finalUsage,
    remaining: rateLimit.remaining,
    resetTime: rateLimit.resetTime,
    ...(coverLetter !== undefined ? { coverLetter } : {}),
  };

  const responseBytes = Buffer.byteLength(
    JSON.stringify(responseBody),
    "utf8"
  );
  if (responseBytes > getTailorResponseMaxBytes()) {
    return {
      ok: false,
      error: "Tailor response exceeds configured size limit",
      status: 422,
    };
  }

  return { ok: true, body: responseBody };
}
