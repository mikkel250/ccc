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

/** Named entities Gmail HTML commonly emits; numeric (dec/hex) covers the rest. */
const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "\u2014",
  ndash: "\u2013",
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201D",
  ldquo: "\u201C",
  hellip: "\u2026",
  bull: "\u2022",
  middot: "\u00B7",
};

function codePointToChar(code: number): string | undefined {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
    return undefined;
  }
  if (code >= 0xd800 && code <= 0xdfff) {
    return undefined;
  }
  return String.fromCodePoint(code);
}

function decodeHtmlEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi,
    (entity, body: string) => {
      const inner = body.toLowerCase();
      if (inner.startsWith("#x")) {
        return codePointToChar(Number.parseInt(inner.slice(2), 16)) ?? entity;
      }
      if (inner.startsWith("#")) {
        return codePointToChar(Number(inner.slice(1))) ?? entity;
      }
      return NAMED_HTML_ENTITIES[inner] ?? entity;
    }
  );
}

function styleDeclaresHidden(style: string): boolean {
  return (
    /display\s*:\s*none/i.test(style) ||
    /visibility\s*:\s*hidden/i.test(style) ||
    /opacity\s*:\s*0(?:\.0*)?(?=\s|;|$)/i.test(style) ||
    /font-size\s*:\s*0(?:px|em|rem|%)?(?=\s|;|$)/i.test(style) ||
    /max-height\s*:\s*0(?:px|em|rem|%)?(?=\s|;|$)/i.test(style)
  );
}

function hiddenStyleInTag(raw: string): boolean {
  const decoded = decodeHtmlEntities(raw);
  const quoted = decoded.match(/style\s*=\s*(["'])([^"']*)\1/i);
  if (quoted && styleDeclaresHidden(quoted[2]!)) {
    return true;
  }
  const unquoted = decoded.match(/style\s*=\s*([^>\s]+)/i);
  return unquoted != null && styleDeclaresHidden(unquoted[1]!);
}

/** Hidden-content policy: drop boolean `hidden`, `aria-hidden="true"`, and hidden inline styles. */
function isHiddenOpeningTag(raw: string): boolean {
  const decoded = decodeHtmlEntities(raw);
  const attrsWithoutValues = decoded.replace(/=\s*("[^"]*"|'[^']*')/g, "");
  return (
    /\shidden(?=[\s=>/])/i.test(attrsWithoutValues) ||
    /\baria-hidden\s*=\s*(["']?)true\1(?=[\s/>])/i.test(decoded) ||
    hiddenStyleInTag(raw)
  );
}

/** Depth-aware omit of comments, head/script/style, and hidden containers. */
function omitHiddenHtml(html: string): string {
  const tokenRe = /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w:-]*)\b[^>]*>/gi;
  let out = "";
  let last = 0;
  let skipName: string | null = null;
  let skipDepth = 0;
  let skipTailStart = 0;
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
      if (!isClose && name === "body" && skipName === "head") {
        skipDepth = 0;
        skipName = null;
        out += raw;
        continue;
      }
      if (!isClose && !selfClosing && name === skipName) {
        skipDepth += 1;
      } else if (isClose && name === skipName) {
        skipDepth -= 1;
        if (skipDepth === 0) {
          skipName = null;
        }
      }
      continue;
    }
    if (!isClose && (WHOLE_TAG_SKIP.has(name) || isHiddenOpeningTag(raw))) {
      if (!selfClosing) {
        skipName = name;
        skipDepth = 1;
        skipTailStart = last;
      }
      continue;
    }
    out += raw;
  }
  if (skipDepth > 0) {
    out += html.slice(skipTailStart);
  } else {
    out += html.slice(last);
  }
  return out;
}

export function htmlToText(html: string): string {
  let withoutBlocks = omitHiddenHtml(html);
  withoutBlocks = decodeHtmlEntities(
    withoutBlocks
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
  return withoutBlocks.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
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
