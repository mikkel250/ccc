/**
 * Mutable dependency bag for POST /api/tailor-cv — enables route-level tests to mock
 * pipeline steps via mock.method on plain object properties (ESM namespace getters are not mockable).
 */
import { checkRateLimit as checkRateLimitImpl } from "./rate-limit";
import { chat as chatImpl, isLlmServiceError as isLlmServiceErrorImpl } from "./llm";
import { authenticateTailorRequest as authenticateTailorRequestImpl } from "./tailor-auth";
import { requireMasterCv as requireMasterCvImpl } from "./master-cv";
import {
  getCuratorPrompt as getCuratorPromptImpl,
  compileCuratorPrompt as compileCuratorPromptImpl,
  buildCuratorUserMessage as buildCuratorUserMessageImpl,
} from "./curator-prompt";
import {
  validateCvJson as validateCvJsonImpl,
  assertCuratedJsonSize as assertCuratedJsonSizeImpl,
} from "./cv-schema";
import { extractStructuredJson as extractStructuredJsonImpl } from "./eval-parse";
import { buildJsonDocxBase64 as buildJsonDocxBase64Impl } from "./json-docx-builder";

export const tailorCvDeps = {
  authenticateTailorRequest: authenticateTailorRequestImpl,
  checkRateLimit: checkRateLimitImpl,
  requireMasterCv: requireMasterCvImpl,
  getCuratorPrompt: getCuratorPromptImpl,
  compileCuratorPrompt: compileCuratorPromptImpl,
  buildCuratorUserMessage: buildCuratorUserMessageImpl,
  chat: chatImpl,
  isLlmServiceError: isLlmServiceErrorImpl,
  extractStructuredJson: extractStructuredJsonImpl,
  validateCvJson: validateCvJsonImpl,
  assertCuratedJsonSize: assertCuratedJsonSizeImpl,
  buildJsonDocxBase64: buildJsonDocxBase64Impl,
};
