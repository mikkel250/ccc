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
const RAW_TEXT_ELEMENTS = new Set(["script", "style"]);
/** Tags that end an unclosed head in HTML and start message content. */
const HEAD_CONTENT_START = new Set([
  "body",
  "p",
  "div",
  "table",
  "span",
  "br",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);
const VOID_HTML_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function styleDeclaresClippingOverflow(style: string): boolean {
  return /(?:^|;)\s*overflow(?:-(?:x|y))?\s*:\s*(?:hidden|clip|scroll)\b/i.test(
    style
  );
}

function styleDeclaresZeroMaxHeight(style: string): boolean {
  return /max-height\s*:\s*0(?:px|em|rem|%)?(?=\s|;|$)/i.test(style);
}

function styleDeclaresSubtreeHidden(style: string): boolean {
  return (
    /display\s*:\s*none/i.test(style) ||
    /visibility\s*:\s*hidden/i.test(style) ||
    /opacity\s*:\s*0(?:\.0*)?(?=\s|;|$)/i.test(style) ||
    (styleDeclaresZeroMaxHeight(style) && styleDeclaresClippingOverflow(style))
  );
}

/** Layout wrappers use font-size:0; descendants can set a real size and stay visible. */
function styleDeclaresFontSizeZero(style: string): boolean {
  return /font-size\s*:\s*0+(?:\.0+)?(?:px|em|rem|%)?(?=\s|;|$)/i.test(style);
}

function styleDeclaresPositiveFontSize(style: string): boolean {
  const match = style.match(
    /font-size\s*:\s*([0-9]*\.?[0-9]+)(?:px|em|rem|%)?(?=\s|;|$)/i
  );
  if (match === null) {
    return false;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0;
}

function tagStyle(raw: string): string | undefined {
  const decoded = decodeHtmlEntities(raw, "replace");
  const quoted = decoded.match(/style\s*=\s*(["'])([^"']*)\1/i);
  if (quoted) {
    return quoted[2];
  }
  const unquoted = decoded.match(/style\s*=\s*([^>\s]+)/i);
  return unquoted?.[1];
}

function hiddenStyleInTag(raw: string): boolean {
  const style = tagStyle(raw);
  return style !== undefined && styleDeclaresSubtreeHidden(style);
}

type TextFrame = { name: string; hide: boolean };

function nextTextHide(style: string | undefined, parentHide: boolean): boolean {
  if (style !== undefined && styleDeclaresPositiveFontSize(style)) {
    return false;
  }
  if (style !== undefined && styleDeclaresFontSizeZero(style)) {
    return true;
  }
  return parentHide;
}

/** Hidden-content policy: drop boolean `hidden`, `aria-hidden="true"`, and hidden inline styles. */
function isHiddenOpeningTag(raw: string): boolean {
  const decoded = decodeHtmlEntities(raw, "replace");
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
  let rawTextName: string | null = null;
  let headInnerDepth = 0;
  const textFrames: TextFrame[] = [];
  const textHidden = (): boolean => textFrames.at(-1)?.hide === true;
  for (const match of html.matchAll(tokenRe)) {
    const index = match.index ?? 0;
    const raw = match[0];
    if (skipDepth === 0 && !textHidden()) {
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
      if (rawTextName !== null) {
        if (isClose && name === rawTextName) {
          rawTextName = null;
        }
        continue;
      }
      if (!isClose && !selfClosing && RAW_TEXT_ELEMENTS.has(name)) {
        rawTextName = name;
        continue;
      }
      if (skipName === "head" && rawTextName === null) {
        const voidElement = selfClosing || VOID_HTML_ELEMENTS.has(name);
        if (
          !isClose &&
          HEAD_CONTENT_START.has(name) &&
          headInnerDepth === 0
        ) {
          skipDepth = 0;
          skipName = null;
          headInnerDepth = 0;
          out += raw;
          continue;
        }
        if (!isClose && !voidElement) {
          headInnerDepth += 1;
          continue;
        }
        if (isClose && headInnerDepth > 0 && name !== "head") {
          headInnerDepth -= 1;
          continue;
        }
      }
      if (!isClose && !selfClosing && name === skipName) {
        skipDepth += 1;
      } else if (isClose && name === skipName) {
        skipDepth -= 1;
        if (skipDepth === 0) {
          skipName = null;
          headInnerDepth = 0;
        }
      }
      continue;
    }
    const voidElement = selfClosing || VOID_HTML_ELEMENTS.has(name);
    if (!isClose && (WHOLE_TAG_SKIP.has(name) || isHiddenOpeningTag(raw))) {
      if (!voidElement) {
        skipName = name;
        skipDepth = 1;
        if (name === "head") {
          headInnerDepth = 0;
        }
      }
      continue;
    }
    if (isClose) {
      while (
        textFrames.length > 0 &&
        textFrames[textFrames.length - 1]!.name !== name
      ) {
        textFrames.pop();
      }
      if (
        textFrames.length > 0 &&
        textFrames[textFrames.length - 1]!.name === name
      ) {
        textFrames.pop();
      }
    } else if (!voidElement) {
      const parentHide = textFrames.at(-1)?.hide === true;
      textFrames.push({
        name,
        hide: nextTextHide(tagStyle(raw), parentHide),
      });
    }
    out += raw;
  }
  if (skipDepth === 0 && !textHidden()) {
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
  QUOT: '"',
  colon: ":",
  Tab: "\t",
  NewLine: "\n",
  amp: "&",
  AMP: "&",
  apos: "'",
  lt: "<",
  LT: "<",
  gt: ">",
  GT: ">",
  COPY: "\u00A9",
  REG: "\u00AE",
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
    code <= 0 ||
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
function decodeHtmlEntities(
  text: string,
  invalidNumeric: "strip" | "replace" = "strip"
): string {
  return text.replace(
    /&(#x[0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]+);/g,
    (full, body: string) => {
      if (body.startsWith("#")) {
        const decoded = decodeNumericEntity(body);
        if (decoded !== undefined) {
          return decoded;
        }
        return invalidNumeric === "replace" ? "\uFFFD" : "";
      }
      return Object.hasOwn(HTML_NAMED_ENTITIES, body)
        ? HTML_NAMED_ENTITIES[body]!
        : full;
    }
  );
}

type CollectedBodies = { plain: string[]; html: string[] };

function isMimeAttachment(node: object): boolean {
  const filename = Reflect.get(node, "filename");
  if (typeof filename === "string" && filename.trim() !== "") {
    return true;
  }
  const body = Reflect.get(node, "body");
  if (body !== null && typeof body === "object") {
    const attachmentId = Reflect.get(body, "attachmentId");
    if (typeof attachmentId === "string" && attachmentId.trim() !== "") {
      return true;
    }
  }
  const headers = Reflect.get(node, "headers");
  if (!Array.isArray(headers)) {
    return false;
  }
  for (const header of headers) {
    if (header === null || typeof header !== "object") continue;
    const name = Reflect.get(header, "name");
    const value = Reflect.get(header, "value");
    if (typeof name !== "string" || typeof value !== "string") continue;
    if (name.toLowerCase() !== "content-disposition") continue;
    if (/(?:^|;)\s*attachment\b/i.test(value)) {
      return true;
    }
  }
  return false;
}

function walkMimeNode(node: unknown, acc: CollectedBodies): void {
  if (node === null || typeof node !== "object") {
    return;
  }
  // Attachment bytes are not the JD. Nested parts still are: a forwarded
  // message/rfc822 is an attachment whose children hold the recruiter mail.
  const attachment = isMimeAttachment(node);
  if (attachment) {
    const parts = Reflect.get(node, "parts");
    if (Array.isArray(parts)) {
      for (const part of parts) {
        walkMimeNode(part, acc);
      }
    }
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
