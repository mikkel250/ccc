/**
 * On-path adversarial judge — critiques the curator's first draft before delivery.
 *
 * Phase 3 of the critique-revise loop. Uses existing `chat()` from llm.ts.
 * Model and prompt are env-configurable. Returns structured critique
 * that the curator can use for revision.
 */
import { chat as defaultChat, type ChatMessage, type ChatResponse, type ChatOptions } from "./llm";
import { extractStructuredJson } from "./eval-parse";
import { getEnvNumber, getEnvString, getTailorModel } from "../../../lib/env";
import type { CurationMode } from "./curation-mode";

type ChatUsage = ChatResponse["usage"];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CritiqueDimension {
  score: number;
  feedback: string;
}

export interface CritiqueResult {
  narrativeCoherence: CritiqueDimension;
  skepticismPreemption: CritiqueDimension;
  overqualificationRisk: CritiqueDimension;
  atsViability: CritiqueDimension;
  redFlags: string[];
  hallucinationConcerns: string[];
  /** Only populated for flexible mode — CV vs cover letter alignment. */
  alignmentIssues?: string[];
  overallAssessment: string;
}

export type CritiqueResponse =
  | { ok: true; critique: CritiqueResult; usage: ChatUsage }
  | { ok: false; error: string; usage?: ChatUsage };

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface CritiqueInput {
  curatedCv: unknown;
  jobDescription: string;
  curationMode: CurationMode;
  coverLetter?: string;
  masterCv?: unknown;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const DEFAULT_ADVERSARIAL_JUDGE_PROMPT = `You are an experienced recruiter with 20+ years in the relevant industry. Review this CV critically — would you advance this candidate? What would make you reject them? {{MASTER_CV_GROUNDING}}

Evaluate the following dimensions:

1. **narrativeCoherence** (0–10): Does the CV tell one clear story? Is the career progression logical?
2. **skepticismPreemption** (0–10): Does it acknowledge gaps or domain switches honestly?
3. **overqualificationRisk** (0–10): Risk that the candidate will leave quickly? (Higher score = lower risk.)
4. **atsViability** (0–10): Would ATS keyword filters reject this CV?
5. **redFlags** (string[]): Inconsistent dates, unexplained gaps, missing metrics, title inflation.
6. **hallucinationConcerns** (string[]): Any claims that look fabricated or implausible?
7. **overallAssessment** (string): One-paragraph summary verdict.

CRITICAL: Be specific. Cite exact claims or sections from the CV. Do not be vague.

{{ALIGNMENT_SECTION}}

Return ONLY valid JSON, no markdown wrapping:
{
  "narrativeCoherence": { "score": 0, "feedback": "..." },
  "skepticismPreemption": { "score": 0, "feedback": "..." },
  "overqualificationRisk": { "score": 0, "feedback": "..." },
  "atsViability": { "score": 0, "feedback": "..." },
  "redFlags": [],
  "hallucinationConcerns": [],
  "overallAssessment": "..."
}`;

const MASTER_CV_GROUNDING_PRESENT =
  "You have access to the candidate's master CV as ground truth. Verify that every claim in the curated CV can be traced to a specific master CV entry.";

const MASTER_CV_GROUNDING_ABSENT =
  "No master CV was provided for this review. Judge the curated CV on its face without assuming a master record.";

const ALIGNMENT_SECTION_FLEXIBLE = `
8. **alignmentIssues** (string[]): Does the cover letter directly contradict or misrepresent the CV?`;

function buildJudgeSystemPrompt(
  curationMode: CurationMode,
  hasMasterCv: boolean
): string {
  const basePrompt =
    getEnvString("ADVERSARIAL_JUDGE_PROMPT") ?? DEFAULT_ADVERSARIAL_JUDGE_PROMPT;
  const grounding = hasMasterCv
    ? MASTER_CV_GROUNDING_PRESENT
    : MASTER_CV_GROUNDING_ABSENT;

  let prompt: string;
  if (basePrompt.includes("{{MASTER_CV_GROUNDING}}")) {
    prompt = basePrompt.split("{{MASTER_CV_GROUNDING}}").join(grounding);
  } else {
    prompt = `${basePrompt}\n\n${grounding}`;
  }

  if (curationMode === "flexible") {
    if (prompt.includes("{{ALIGNMENT_SECTION}}")) {
      return prompt.split("{{ALIGNMENT_SECTION}}").join(ALIGNMENT_SECTION_FLEXIBLE);
    }
    return `${prompt}\n${ALIGNMENT_SECTION_FLEXIBLE}`;
  }

  if (prompt.includes("{{ALIGNMENT_SECTION}}")) {
    return prompt.split("{{ALIGNMENT_SECTION}}").join("");
  }
  return prompt;
}

export function buildJudgeUserMessage(input: CritiqueInput): string {
  const parts: string[] = [
    "## Job Description",
    input.jobDescription,
  ];
  if (input.masterCv) {
    parts.push(
      "",
      "## Master CV (ground truth)",
      JSON.stringify(input.masterCv, null, 2),
    );
  }
  parts.push(
    "",
    "## Curated CV (JSON)",
    JSON.stringify(input.curatedCv, null, 2),
  );
  if (input.coverLetter) {
    parts.push("", "## Cover Letter", input.coverLetter);
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const REQUIRED_DIMENSIONS = [
  "narrativeCoherence",
  "skepticismPreemption",
  "overqualificationRisk",
  "atsViability",
] as const;

export function isCritiqueResult(raw: unknown): raw is CritiqueResult {
  if (!raw || typeof raw !== "object") return false;
  const obj = raw as Record<string, unknown>;

  for (const dim of REQUIRED_DIMENSIONS) {
    const val = obj[dim];
    if (!val || typeof val !== "object") return false;
    const dimObj = val as Record<string, unknown>;
    if (typeof dimObj.score !== "number") return false;
    if (!Number.isFinite(dimObj.score) || dimObj.score < 0 || dimObj.score > 10) return false;
    if (typeof dimObj.feedback !== "string") return false;
  }

  if (!Array.isArray(obj.redFlags)) return false;
  if (!Array.isArray(obj.hallucinationConcerns)) return false;
  if (typeof obj.overallAssessment !== "string") return false;

  if (obj.alignmentIssues !== undefined) {
    if (!Array.isArray(obj.alignmentIssues)) return false;
    if (!obj.alignmentIssues.every((item: unknown) => typeof item === "string")) {
      return false;
    }
  }

  if (!obj.redFlags.every((item: unknown) => typeof item === "string")) return false;
  if (!obj.hallucinationConcerns.every((item: unknown) => typeof item === "string")) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export interface CritiqueOptions {
  /** Test-only: inject a chat implementation. */
  chat?: (
    messages: ChatMessage[] | Omit<ChatMessage, "role">[],
    systemPrompt: string,
    options?: {
      model?: string;
      source?: string;
      langfusePrompt?: ChatOptions["langfusePrompt"];
      signal?: AbortSignal;
    }
  ) => Promise<ChatResponse>;
  /** Bound the judge LLM call; on timeout/abort return ok:false. */
  timeoutMs?: number;
  /** Optional external deadline; combined with timeoutMs when both are set. */
  signal?: AbortSignal;
}

async function chatWithDeadline(
  chatFn: NonNullable<CritiqueOptions["chat"]>,
  messages: ChatMessage[],
  systemPrompt: string,
  chatOptions: {
    model?: string;
    source?: string;
    langfusePrompt?: ChatOptions["langfusePrompt"];
    signal?: AbortSignal;
  },
  timeoutMs: number
): Promise<ChatResponse> {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (chatOptions.signal) {
    if (chatOptions.signal.aborted) {
      controller.abort();
    } else {
      chatOptions.signal.addEventListener("abort", onExternalAbort, {
        once: true,
      });
    }
  }

  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const chatPromise = chatFn(messages, systemPrompt, {
      ...chatOptions,
      signal: controller.signal,
    });
    // Prevent unhandled rejection if timeout wins the race first.
    void chatPromise.catch(() => undefined);
    return await Promise.race([
      chatPromise,
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => {
            reject(
              Object.assign(new Error("Judge call timed out"), {
                name: "TimeoutError",
              })
            );
          },
          { once: true }
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    chatOptions.signal?.removeEventListener("abort", onExternalAbort);
  }
}

export async function critiqueCvDraft(
  input: CritiqueInput,
  options?: CritiqueOptions
): Promise<CritiqueResponse> {
  const chatFn = options?.chat ?? defaultChat;
  const model =
    getEnvString("ADVERSARIAL_JUDGE_MODEL") ?? getTailorModel();
  const systemPrompt = buildJudgeSystemPrompt(
    input.curationMode,
    input.masterCv !== undefined && input.masterCv !== null
  );
  const userMessage = buildJudgeUserMessage(input);
  const timeoutMs =
    options?.timeoutMs ??
    getEnvNumber("ADVERSARIAL_JUDGE_TIMEOUT_MS", 15_000);

  let response: ChatResponse;
  try {
    response = await chatWithDeadline(
      chatFn,
      [{ role: "user", content: userMessage }],
      systemPrompt,
      {
        model,
        source: "tailor-cv-judge",
        signal: options?.signal,
      },
      timeoutMs
    );
  } catch (error: unknown) {
    const aborted =
      (error instanceof Error && error.name === "TimeoutError") ||
      (error instanceof Error && /timed out/i.test(error.message));
    if (aborted) {
      return { ok: false, error: "Judge call timed out" };
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = extractStructuredJson(response.content);
  } catch {
    return {
      ok: false,
      error: "Judge output was not valid JSON",
      usage: response.usage,
    };
  }

  if (!isCritiqueResult(parsed)) {
    return {
      ok: false,
      error: "Judge output was incomplete or missing required fields",
      usage: response.usage,
    };
  }

  return { ok: true, critique: parsed, usage: response.usage };
}
