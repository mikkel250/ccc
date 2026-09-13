/**
 * Strict curator chat payload: wrapper { curated_cv, reply_text }.
 */
export const DEFAULT_STRICT_REPLY =
  "Thank you for reaching out. I would welcome a conversation about this role.";

export function strictCuratorPayload(
  curated: unknown,
  replyText: string = DEFAULT_STRICT_REPLY
): { curated_cv: unknown; reply_text: string } {
  return { curated_cv: curated, reply_text: replyText };
}

export function strictCuratorJson(
  curated: unknown,
  replyText: string = DEFAULT_STRICT_REPLY
): string {
  return JSON.stringify(strictCuratorPayload(curated, replyText));
}
