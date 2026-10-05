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
const RECOVERY_BLOCK_TAGS = new Set([
  "p",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "td",
  "th",
  "blockquote",
]);

function htmlTokenRe(): RegExp {
  return /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w:-]*)\b[^>]*>/gi;
}
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
  const decoded = decodeHtmlEntities(raw);
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
  const decoded = decodeHtmlEntities(raw);
  const attrsWithoutValues = decoded.replace(/=\s*("[^"]*"|'[^']*')/g, "");
  return (
    /\shidden(?=[\s=>/])/i.test(attrsWithoutValues) ||
    /\baria-hidden\s*=\s*(["']?)true\1(?=[\s/>])/i.test(decoded) ||
    hiddenStyleInTag(raw)
  );
}

/** First block tag after an unclosed hidden opener. No block means the tail stays omitted. */
function recoverUnclosedHiddenTail(
  html: string,
  afterOpenIndex: number
): string | undefined {
  const tail = html.slice(afterOpenIndex);
  let rawTextName: string | null = null;
  for (const match of tail.matchAll(htmlTokenRe())) {
    const raw = match[0];
    const index = match.index ?? 0;
    if (raw.startsWith("<!--")) {
      continue;
    }
    const name = match[1]!.toLowerCase();
    const isClose = raw.startsWith("</");
    const selfClosing = /\/\s*>$/.test(raw);
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
    if (!isClose && RECOVERY_BLOCK_TAGS.has(name)) {
      return tail.slice(index);
    }
  }
  return undefined;
}

/** Depth-aware omit of comments, head/script/style, and hidden containers. */
function omitHiddenHtml(html: string, seedFrames: TextFrame[] = []): string {
  const tokenRe = htmlTokenRe();
  let out = "";
  let last = 0;
  let skipName: string | null = null;
  let skipDepth = 0;
  let unclosedHiddenStart: number | null = null;
  let rawTextName: string | null = null;
  let headInnerDepth = 0;
  const textFrames: TextFrame[] = seedFrames.map((frame) => ({ ...frame }));
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
          unclosedHiddenStart = null;
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
          unclosedHiddenStart = null;
        }
      }
      continue;
    }
    const voidElement = selfClosing || VOID_HTML_ELEMENTS.has(name);
    if (!isClose && (WHOLE_TAG_SKIP.has(name) || isHiddenOpeningTag(raw))) {
      if (!voidElement) {
        skipName = name;
        skipDepth = 1;
        unclosedHiddenStart =
          isHiddenOpeningTag(raw) && !WHOLE_TAG_SKIP.has(name)
            ? index + raw.length
            : null;
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
  } else if (unclosedHiddenStart !== null) {
    const recovered = recoverUnclosedHiddenTail(html, unclosedHiddenStart);
    if (recovered !== undefined) {
      out += omitHiddenHtml(recovered, textFrames);
    }
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
