/**
 * Gmail message payload → job-description string (R7).
 * Prefer text/plain; otherwise html-to-text. No JD-isolation model.
 */

export type GmailBodyResult =
  | { ok: true; jobDescription: string }
  | { ok: false; error: string };

function decodeGmailBodyData(data: unknown): string | undefined {
  if (typeof data !== "string" || data.trim() === "") {
    return undefined;
  }
  try {
    return Buffer.from(data, "base64url").toString("utf8");
  } catch {
    return undefined;
  }
}

const WHOLE_TAG_SKIP = new Set(["head", "script", "style"]);
const BLOCK_TAG_OPEN_RE = /<(?:p|div|h[1-6]|li|td|th|blockquote)\b[^>]*>/i;

function isHiddenOpeningTag(raw: string): boolean {
  return (
    /\bhidden\b/i.test(raw) ||
    /style\s*=\s*(["'])[^"'<>]*display\s*:\s*none[^"'<>]*\1/i.test(raw)
  );
}

function normalizeTextWhitespace(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function stripHtmlMarkup(html: string): string {
  const withoutTags = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_m, digits: string) => {
      const code = Number(digits);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    });
  return normalizeTextWhitespace(withoutTags);
}

/** Recover visible copy after broken tracking HTML with an unclosed hidden opener. */
function recoverUnclosedHiddenTail(html: string, afterOpenIndex: number): string {
  const tail = html.slice(afterOpenIndex);
  const blockMatch = BLOCK_TAG_OPEN_RE.exec(tail);
  const fromBlock = blockMatch ? tail.slice(blockMatch.index) : tail;
  return stripHtmlMarkup(fromBlock);
}

/** Depth-aware omit of comments, head/script/style, and hidden containers. */
function omitHiddenHtml(html: string): string {
  const tokenRe = /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w:-]*)\b[^>]*>/gi;
  let out = "";
  let last = 0;
  let skipName: string | null = null;
  let skipDepth = 0;
  let unclosedHiddenStart: number | null = null;
  for (const match of html.matchAll(tokenRe)) {
    const index = match.index ?? 0;
    const raw = match[0];
    if (skipDepth === 0) {
      out += html.slice(last, index);
    }
    last = index + raw.length;
    if (raw.startsWith("<!--")) {
      continue;
    }
    const name = match[1]!.toLowerCase();
    const isClose = raw.startsWith("</");
    const selfClosing = /\/\s*>$/.test(raw);
    if (skipDepth > 0) {
      if (!isClose && !selfClosing && name === skipName) {
        skipDepth += 1;
      } else if (isClose && name === skipName) {
        skipDepth -= 1;
        if (skipDepth === 0) {
          skipName = null;
          unclosedHiddenStart = null;
        }
      }
      continue;
    }
    if (!isClose && (WHOLE_TAG_SKIP.has(name) || isHiddenOpeningTag(raw))) {
      if (!selfClosing) {
        skipName = name;
        skipDepth = 1;
        unclosedHiddenStart = isHiddenOpeningTag(raw) ? index + raw.length : null;
      }
      continue;
    }
    out += raw;
  }
  if (skipDepth === 0) {
    out += html.slice(last);
  } else if (unclosedHiddenStart !== null) {
    out += recoverUnclosedHiddenTail(html, unclosedHiddenStart);
  } else {
    out += html.slice(last);
  }
  return out;
}

export function htmlToText(html: string): string {
  return stripHtmlMarkup(omitHiddenHtml(html));
}

type CollectedBodies = { plain: string[]; html: string[] };

function walkMimeNode(node: unknown, acc: CollectedBodies): void {
  if (node === null || typeof node !== "object") {
    return;
  }
  const mimeTypeRaw = Reflect.get(node, "mimeType");
  const mimeType = typeof mimeTypeRaw === "string" ? mimeTypeRaw.toLowerCase() : "";
  const body = Reflect.get(node, "body");
  const data =
    body !== null && typeof body === "object"
      ? Reflect.get(body, "data")
      : undefined;
  const decoded = decodeGmailBodyData(data);
  if (decoded !== undefined) {
    if (mimeType.startsWith("text/plain")) {
      acc.plain.push(decoded);
    } else if (mimeType.startsWith("text/html")) {
      acc.html.push(decoded);
    }
  }
  const parts = Reflect.get(node, "parts");
  if (Array.isArray(parts)) {
    for (const part of parts) {
      walkMimeNode(part, acc);
    }
  }
}

export function extractGmailJobDescription(message: unknown): GmailBodyResult {
  if (message === null || typeof message !== "object") {
    return { ok: false, error: "Gmail message was not an object" };
  }
  const payload = Reflect.get(message, "payload");
  const acc: CollectedBodies = { plain: [], html: [] };
  walkMimeNode(payload, acc);
  const plain = acc.plain.map((s) => s.trim()).filter((s) => s.length > 0);
  if (plain.length > 0) {
    return { ok: true, jobDescription: plain.join("\n\n") };
  }
  const html = acc.html.map((s) => htmlToText(s)).filter((s) => s.length > 0);
  if (html.length > 0) {
    return { ok: true, jobDescription: html.join("\n\n") };
  }
  return { ok: false, error: "Gmail message had no usable text body" };
}
