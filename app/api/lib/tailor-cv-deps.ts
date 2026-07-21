/**
 * Mutable dependency bag for POST /api/tailor-cv — enables route-level tests to mock
 * pipeline steps via mock.method on plain object properties (ESM namespace getters are not mockable).
 */
import { checkRateLimit as checkRateLimitImpl } from "./rate-limit";
import { getAllContext as getAllContextImpl } from "./knowledge-base";
import { getCvPrompt as getCvPromptImpl, compileCvPrompt as compileCvPromptImpl } from "./cv-prompt";
import { chat as chatImpl, isLlmServiceError as isLlmServiceErrorImpl } from "./llm";
import { markdownToDocxBase64 as markdownToDocxBase64Impl } from "./markdown-docx";

import { authenticateTailorRequest as authenticateTailorRequestImpl } from "./tailor-auth";

export const tailorCvDeps = {
  authenticateTailorRequest: authenticateTailorRequestImpl,
  checkRateLimit: checkRateLimitImpl,
  getAllContext: getAllContextImpl,
  getCvPrompt: getCvPromptImpl,
  compileCvPrompt: compileCvPromptImpl,
  chat: chatImpl,
  isLlmServiceError: isLlmServiceErrorImpl,
  markdownToDocxBase64: markdownToDocxBase64Impl,
};
