/**
 * Tailor curation posture: strict Struan subset vs flexible grounded collapse.
 */
import { getDefaultCurationMode } from "../../../lib/env";

export const CURATION_MODES = ["strict", "flexible"] as const;
export type CurationMode = (typeof CURATION_MODES)[number];

/** Shared default when request omits curationMode (from TAILOR_DEFAULT_CURATION_MODE). */
export const DEFAULT_CURATION_MODE: CurationMode = getDefaultCurationMode();

export const CURATION_MODE_POLICY_PLACEHOLDER = "{{CURATION_MODE_POLICY}}";

export function isCurationMode(value: unknown): value is CurationMode {
  return value === "strict" || value === "flexible";
}

/** Authoritative mode block injected into the curator system prompt. */
export function curationModePolicy(mode: CurationMode): string {
  if (mode === "strict") {
    return `MODE: strict (default Struan subset).
- Keep or drop discrete master experience entries only.
- Do not collapse, merge, or rewrite multiple roles into a category-style summary entry.
- When a role is kept: title, location, dates, and blurb stay unchanged; bullets may be
  ranked, trimmed, or dropped — not fact-rewritten.
- Prefer aggressively cutting weak-fit roles/skills over keeping a long weakly aligned CV.`;
  }

  return `MODE: flexible (grounded compression allowed).
- Identify the JD's domain and must-haves first. Lead experience[] with the strongest JD-fit
  roles (or one strong summary cluster). Do not lead with weak-fit roles merely because they
  are recent or prestigious.
- Recency does not override weak JD fit: recent off-domain roles should be cut or collapsed,
  not kept as top discrete entries.
- You may cut, shorten, reorder, and — when role-by-role detail is low-value for this JD —
  collapse a weak-fit cluster into one grounded category-style summary role whose title names
  the domain of that cluster (derive the label from the master roles being collapsed).
- Collapsed entries: date span must cover the collapsed master roles; title/location may be
  category-style; 1-3 high-level bullets that honestly summarize transferable themes —
  no invented metrics, promotions, or named employers absent from the master.
- When keeping a discrete master role: title/location/dates/blurb unchanged; bullets may be
  ranked, trimmed, or dropped — not fact-rewritten.
- Prefer hard cull or honest collapse of weak-fit detail over a long weakly aligned CV.
- Rules are industry-agnostic: the same posture applies whether the JD is technical,
  operational, creative, service, or any other domain.`;
}

/**
 * Inject mode policy into a curator prompt template.
 * If the placeholder is missing (e.g. older Langfuse prompt), append an authoritative block.
 */
export function applyCurationModePolicy(
  promptText: string,
  mode: CurationMode
): string {
  const policy = curationModePolicy(mode);
  if (promptText.includes(CURATION_MODE_POLICY_PLACEHOLDER)) {
    return promptText.split(CURATION_MODE_POLICY_PLACEHOLDER).join(policy);
  }
  return `${promptText}\n\n<curation_mode>\n${policy}\n</curation_mode>`;
}

/** Grounding-judge addendum so smoke scoring matches the requested mode. */
export function groundingJudgeModeAddendum(mode: CurationMode): string {
  if (mode === "strict") {
    return `Curation mode for this run: strict.
Category-style collapsed experience entries are NOT acceptable.
Flag curated experience titles/employers that are not present as discrete master roles
(unless they are verbatim master titles).`;
  }

  return `Curation mode for this run: flexible.
Accept collapsing several master experience entries into one category-style summary role
when the title/location/date span and bullets honestly summarize those master roles
without inventing metrics or fake named employers.
Strong JD-fit roles may lead; recent off-domain roles may be collapsed or omitted —
that alone is not identity-breaking fabrication.
Still flag invented metrics, tools, certs, and false named employers.`;
}
