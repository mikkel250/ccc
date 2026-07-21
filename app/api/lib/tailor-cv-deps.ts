/**
 * Mutable dependency bag for POST /api/tailor-cv.
 *
 * Every pipeline function the route handler calls is re-exported as a property
 * of this plain object. Tests use `mock.method(tailorCvDeps, ...)` to swap
 * individual steps without reaching into compiled ESM namespace getters, which
 * Node's `mock.method` cannot intercept. Each property name matches the
 * function name so route code reads naturally (`tailorCvDeps.requireMasterCv()`).
 *
 * This is NOT a general-purpose DI container — there is no interface, no
 * dynamic resolution, and no runtime swapping outside tests. It exists solely
 * because ES module namespace exports are not mockable in Node ≥22.
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
import { buildJsonDocxBase64 as buildJsonDocxBase64Impl, sanitizeCvJson } from "./json-docx-builder";

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
  sanitizeForResponse: sanitizeCvJson,
};
