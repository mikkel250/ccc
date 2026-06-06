/**
 * Stage 1 of the eval pipeline: structured JD extraction via LLM.
 *
 * Output feeds extraction scoring and Stage 2 relevance/hallucination judges.
 * Gated by EVAL_EXTRACTION_MIN_SCORE in scripts/eval-cv.ts — bad extractions skip
 * expensive CV generation for that JD. Not used by production tailor-cv.
 */
import { chat, type ChatMessage, type ChatResponse } from "./llm";
import { getEvalExtractionModel } from "../../../lib/env";
import type { JdExtraction, JdKeywordBank, JdRequirement } from "./eval-schema";
import { extractStructuredJson } from "./eval-judge";

type ChatFn = (
  messages: ChatMessage[] | Omit<ChatMessage, "role">[],
  systemPrompt: string,
  options?: { model?: string; source?: string }
) => Promise<ChatResponse>;

export interface ExtractJdMetadataOptions {
  model?: string;
  chat?: ChatFn;
}

const EXTRACTION_SYSTEM_PROMPT = `You extract structured job description metadata from raw recruiter text.

Rules:
- NEVER fabricate requirements, keywords, or signals not present in the JD.
- Label missing fields with sensible defaults: empty arrays, "Unknown" for strings, "Default" for hiringContext.
- Normalize 6-12 requirements as testable statements with Must-Have or Nice-to-Have weights.
- Include a keyword bank: mustHaves, tools, certifications, verbs (ATS-optimized clusters).

Respond with JSON only matching this shape:
{
  "requirements": [{"statement": "...", "weight": "Must-Have"|"Nice-to-Have", "keywords": ["..."]}],
  "hiringContext": "Hypergrowth|Regulated|Research|Agency|Default",
  "roleType": "Frontend|Backend|Full-stack|Platform|DevOps|ML|...",
  "topTechnologies": ["...", "...", "..."],
  "primaryResponsibilities": ["..."],
  "title": "...",
  "seniority": "IC|Manager|Director|VP|C-suite",
  "domainKnowledge": ["..."],
  "keyVerbs": ["..."],
  "implicitSuccessSignals": ["..."],
  "keywordBank": {"mustHaves": [], "tools": [], "certifications": [], "verbs": []}
}`;

function emptyExtraction(rawJd: string): JdExtraction {
  return {
    requirements: [],
    hiringContext: "Default",
    roleType: "Unknown",
    topTechnologies: [],
    primaryResponsibilities: [],
    title: "Unknown",
    seniority: "Unknown",
    domainKnowledge: [],
    keyVerbs: [],
    implicitSuccessSignals: [],
    keywordBank: { mustHaves: [], tools: [], certifications: [], verbs: [] },
    rawJd,
  };
}

function parseRequirements(value: unknown): JdRequirement[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      statement: typeof item.statement === "string" ? item.statement : "",
      weight: item.weight === "Nice-to-Have" ? "Nice-to-Have" : "Must-Have",
      keywords: Array.isArray(item.keywords)
        ? item.keywords.filter((k): k is string => typeof k === "string")
        : [],
    }))
    .filter((r) => r.statement.length > 0);
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function parseKeywordBank(value: unknown): JdKeywordBank {
  if (typeof value !== "object" || value === null) {
    return { mustHaves: [], tools: [], certifications: [], verbs: [] };
  }
  const bank = value as Record<string, unknown>;
  return {
    mustHaves: parseStringArray(bank.mustHaves),
    tools: parseStringArray(bank.tools),
    certifications: parseStringArray(bank.certifications),
    verbs: parseStringArray(bank.verbs),
  };
}

function parseExtractionPayload(raw: unknown, rawJd: string): JdExtraction {
  if (typeof raw !== "object" || raw === null) {
    return emptyExtraction(rawJd);
  }
  const data = raw as Record<string, unknown>;
  return {
    requirements: parseRequirements(data.requirements),
    hiringContext: typeof data.hiringContext === "string" ? data.hiringContext : "Default",
    roleType: typeof data.roleType === "string" ? data.roleType : "Unknown",
    topTechnologies: parseStringArray(data.topTechnologies).slice(0, 3),
    primaryResponsibilities: parseStringArray(data.primaryResponsibilities),
    title: typeof data.title === "string" ? data.title : "Unknown",
    seniority: typeof data.seniority === "string" ? data.seniority : "Unknown",
    domainKnowledge: parseStringArray(data.domainKnowledge),
    keyVerbs: parseStringArray(data.keyVerbs),
    implicitSuccessSignals: parseStringArray(data.implicitSuccessSignals),
    keywordBank: parseKeywordBank(data.keywordBank),
    rawJd,
  };
}

export async function extractJdMetadata(
  jdContent: string,
  options: ExtractJdMetadataOptions = {}
): Promise<JdExtraction> {
  const chatFn = options.chat ?? chat;
  const model = options.model ?? getEvalExtractionModel();

  if (!jdContent.trim()) {
    return emptyExtraction(jdContent);
  }

  try {
    const response = await chatFn(
      [{ role: "user", content: `Extract structured metadata from this job description:\n\n${jdContent}` }],
      EXTRACTION_SYSTEM_PROMPT,
      { model, source: "eval-jd-extraction" }
    );

    const parsed = extractStructuredJson(response.content);
    return parseExtractionPayload(parsed, jdContent);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("extractJdMetadata parse failure:", message);
    return emptyExtraction(jdContent);
  }
}
