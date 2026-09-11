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

function isHiddenOpeningTag(raw: string): boolean {
  return (
    /\bhidden\b/i.test(raw) ||
    /style\s*=\s*(["'])[^"'<>]*display\s*:\s*none[^"'<>]*\1/i.test(raw)
  );
}

/** Depth-aware omit of comments, head/script/style, and hidden containers. */
function omitHiddenHtml(html: string): string {
  const tokenRe = /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w:-]*)\b[^>]*>/gi;
  let out = "";
  let last = 0;
  let skipName: string | null = null;
  let skipDepth = 0;
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
        }
      }
      continue;
    }
    if (!isClose && (WHOLE_TAG_SKIP.has(name) || isHiddenOpeningTag(raw))) {
      if (!selfClosing) {
        skipName = name;
        skipDepth = 1;
      }
      continue;
    }
    out += raw;
  }
  if (skipDepth === 0) {
    out += html.slice(last);
  }
  return out;
}

export function htmlToText(html: string): string {
  let withoutBlocks = omitHiddenHtml(html);
  withoutBlocks = withoutBlocks
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  withoutBlocks = decodeHtmlEntities(withoutBlocks);
  return withoutBlocks.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

/** HTML 4.01 Latin-1 named entities, code points 160–255 in spec order. */
const LATIN1_ENTITY_NAMES = [
  "nbsp", "iexcl", "cent", "pound", "curren", "yen", "brvbar", "sect",
  "uml", "copy", "ordf", "laquo", "not", "shy", "reg", "macr",
  "deg", "plusmn", "sup2", "sup3", "acute", "micro", "para", "middot",
  "cedil", "sup1", "ordm", "raquo", "frac14", "frac12", "frac34", "iquest",
  "Agrave", "Aacute", "Acirc", "Atilde", "Auml", "Aring", "AElig", "Ccedil",
  "Egrave", "Eacute", "Ecirc", "Euml", "Igrave", "Iacute", "Icirc", "Iuml",
  "ETH", "Ntilde", "Ograve", "Oacute", "Ocirc", "Otilde", "Ouml", "times",
  "Oslash", "Ugrave", "Uacute", "Ucirc", "Uuml", "Yacute", "THORN", "szlig",
  "agrave", "aacute", "acirc", "atilde", "auml", "aring", "aelig", "ccedil",
  "egrave", "eacute", "ecirc", "euml", "igrave", "iacute", "icirc", "iuml",
  "eth", "ntilde", "ograve", "oacute", "ocirc", "otilde", "ouml", "divide",
  "oslash", "ugrave", "uacute", "ucirc", "uuml", "yacute", "thorn", "yuml",
] as const;

const HTML_NAMED_ENTITIES: Record<string, string> = {
  quot: '"',
  amp: "&",
  AMP: "&",
  apos: "'",
  lt: "<",
  LT: "<",
  gt: ">",
  GT: ">",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
  lsquo: "\u2018",
  rsquo: "\u2019",
  sbquo: "\u201A",
  ldquo: "\u201C",
  rdquo: "\u201D",
  bdquo: "\u201E",
  dagger: "\u2020",
  Dagger: "\u2021",
  permil: "\u2030",
  lsaquo: "\u2039",
  rsaquo: "\u203A",
  euro: "\u20AC",
  trade: "\u2122",
  bull: "\u2022",
  circ: "\u02C6",
  tilde: "\u02DC",
  ensp: "\u2002",
  emsp: "\u2003",
  thinsp: "\u2009",
  zwnj: "\u200C",
  zwj: "\u200D",
  lrm: "\u200E",
  rlm: "\u200F",
  OElig: "\u0152",
  oelig: "\u0153",
  Scaron: "\u0160",
  scaron: "\u0161",
  Yuml: "\u0178",
  fnof: "\u0192",
};

for (let i = 0; i < LATIN1_ENTITY_NAMES.length; i += 1) {
  HTML_NAMED_ENTITIES[LATIN1_ENTITY_NAMES[i]!] = String.fromCharCode(160 + i);
}
HTML_NAMED_ENTITIES.nbsp = " ";

function decodeNumericEntity(body: string): string | undefined {
  const hex = body[1] === "x" || body[1] === "X";
  const digits = hex ? body.slice(2) : body.slice(1);
  const code = Number.parseInt(digits, hex ? 16 : 10);
  if (
    !Number.isFinite(code) ||
    code < 0 ||
    code > 0x10ffff ||
    (code >= 0xd800 && code <= 0xdfff)
  ) {
    return undefined;
  }
  if (code === 160) {
    return " ";
  }
  try {
    return String.fromCodePoint(code);
  } catch {
    return undefined;
  }
}

/** Decode named and numeric (decimal + hex) HTML entities after tags are stripped. */
function decodeHtmlEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]+);/g,
    (full, body: string) => {
      if (body.startsWith("#")) {
        return decodeNumericEntity(body) ?? "";
      }
      return Object.hasOwn(HTML_NAMED_ENTITIES, body)
        ? HTML_NAMED_ENTITIES[body]!
        : full;
    }
  );
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
