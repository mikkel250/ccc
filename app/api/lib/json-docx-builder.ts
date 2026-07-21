/**
 * Mechanical JSON → .docx builder (KTD2 / R5c / R6d).
 * Port of references/json-curator/resume_builder.js — layout parity, TypeScript rewrite.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Packer,
  Paragraph,
  TextRun,
} from "docx";

/** Bump when layout or output semantics change (R5c). */
export const BUILDER_VERSION = "1.0.0";

const COLOR_MUTED = "333333";
const COLOR_BORDER = "1A2B4C";
const FONT = "Times New Roman";

/** C0 controls except TAB (0x09) and LF (0x0A); also DEL (KTD11 / R6d). */
const DISALLOWED_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function sanitizeCvText(value: string): string {
  return value.replace(DISALLOWED_CONTROL, "");
}

/** Recursively sanitize all string leaves in curated/master CV JSON. */
export function sanitizeCvJson(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeCvText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeCvJson(item));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeCvJson(v);
    }
    return out;
  }
  return value;
}

interface ContactLink {
  label: string;
  url: string;
}

interface Contact {
  location: string;
  phone: string;
  email: string;
  links: ContactLink[];
}

interface SkillCategory {
  category: string;
  items: string;
}

interface Subrole {
  heading: string;
  bullets: string[];
}

interface ExperienceRole {
  title: string;
  location?: string;
  dates?: string;
  blurb?: string;
  bullets?: string[];
  subroles?: Subrole[];
}

interface Project {
  name: string;
  linkLabel: string;
  linkUrl: string;
  bullets: string[];
}

interface ResumeCv {
  name: string;
  contact: Contact;
  summary?: string[];
  skills?: SkillCategory[];
  experience?: ExperienceRole[];
  projects?: Project[];
  portfolioSites?: string[];
  education?: string[];
  certifications?: string[];
}

function asResumeCv(data: unknown): ResumeCv {
  if (data === null || typeof data !== "object") {
    throw new Error("CV JSON must be an object");
  }
  const cv = data as ResumeCv;
  if (typeof cv.name !== "string" || !cv.contact || typeof cv.contact !== "object") {
    throw new Error("CV JSON missing required name/contact");
  }
  return cv;
}

function sectionHeader(text: string): Paragraph {
  return new Paragraph({
    border: {
      bottom: {
        style: BorderStyle.SINGLE,
        size: 6,
        color: COLOR_BORDER,
        space: 1,
      },
    },
    spacing: { before: 240, after: 100 },
    children: [new TextRun({ text, bold: true, size: 32, font: FONT })],
  });
}

function bullet(text: string, opts: { after?: number } = {}): Paragraph {
  return new Paragraph({
    numbering: { reference: "bullet-list", level: 0 },
    spacing: { after: opts.after ?? 60 },
    children: [new TextRun({ text, size: 21, font: FONT })],
  });
}

function linkRun(label: string, url: string): ExternalHyperlink {
  return new ExternalHyperlink({
    link: url,
    children: [
      new TextRun({ text: label, style: "Hyperlink", size: 19, font: FONT }),
    ],
  });
}

function contactLine(contact: Contact): Paragraph {
  const runs: (TextRun | ExternalHyperlink)[] = [
    new TextRun({
      text: `${contact.location}  |  ${contact.phone}  |  `,
      color: COLOR_MUTED,
      bold: true,
      size: 19,
      font: FONT,
    }),
    linkRun(contact.email, `mailto:${contact.email}`),
  ];
  for (const l of contact.links ?? []) {
    runs.push(
      new TextRun({
        text: "  |  ",
        color: COLOR_MUTED,
        bold: true,
        size: 19,
        font: FONT,
      })
    );
    runs.push(linkRun(l.label, l.url));
  }
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: runs,
  });
}

function jobHeader(title: string, location?: string, dates?: string): Paragraph {
  const runs: TextRun[] = [
    new TextRun({ text: title, bold: true, size: 21, font: FONT }),
  ];
  for (const part of [location, dates].filter(Boolean) as string[]) {
    runs.push(new TextRun({ text: " | ", size: 21, font: FONT }));
    runs.push(
      new TextRun({ text: part, color: COLOR_MUTED, size: 21, font: FONT })
    );
  }
  return new Paragraph({ spacing: { after: 40 }, children: runs });
}

function blurb(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 80 },
    children: [
      new TextRun({
        text,
        italics: true,
        color: COLOR_MUTED,
        size: 21,
        font: FONT,
      }),
    ],
  });
}

function subroleHeading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 40, after: 40 },
    children: [
      new TextRun({
        text,
        bold: true,
        italics: true,
        size: 21,
        font: FONT,
      }),
    ],
  });
}

function buildDocument(data: ResumeCv): Document {
  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 240, after: 100 },
      children: [
        new TextRun({ text: data.name, bold: true, size: 40, font: FONT }),
      ],
    })
  );
  children.push(contactLine(data.contact));

  if (data.summary?.length) {
    children.push(sectionHeader("SUMMARY"));
    for (const s of data.summary) {
      children.push(bullet(s));
    }
  }

  if (data.skills?.length) {
    children.push(sectionHeader("TECHNICAL SKILLS"));
    for (const s of data.skills) {
      children.push(
        new Paragraph({
          spacing: { after: 60 },
          children: [
            new TextRun({
              text: `${s.category}: `,
              bold: true,
              size: 21,
              font: FONT,
            }),
            new TextRun({ text: s.items, size: 21, font: FONT }),
          ],
        })
      );
    }
  }

  if (data.experience?.length) {
    children.push(sectionHeader("PROFESSIONAL EXPERIENCE"));
    for (const role of data.experience) {
      children.push(jobHeader(role.title, role.location, role.dates));
      if (role.blurb) children.push(blurb(role.blurb));
      if (role.subroles?.length) {
        for (const sr of role.subroles) {
          children.push(subroleHeading(sr.heading));
          for (const b of sr.bullets) {
            children.push(bullet(b));
          }
        }
      } else if (role.bullets?.length) {
        role.bullets.forEach((b, i) =>
          children.push(
            bullet(b, {
              after: i === role.bullets!.length - 1 ? 140 : 60,
            })
          )
        );
      }
    }
  }

  if (data.projects?.length) {
    children.push(sectionHeader("PROJECTS"));
    for (const p of data.projects) {
      children.push(
        new Paragraph({
          spacing: { after: 40 },
          children: [
            new TextRun({
              text: `${p.name} — `,
              bold: true,
              size: 21,
              font: FONT,
            }),
            new ExternalHyperlink({
              link: p.linkUrl,
              children: [
                new TextRun({
                  text: p.linkLabel,
                  bold: false,
                  style: "Hyperlink",
                  size: 21,
                  font: FONT,
                }),
              ],
            }),
          ],
        })
      );
      for (const b of p.bullets) {
        children.push(bullet(b, { after: 100 }));
      }
    }
  }

  if (data.portfolioSites?.length) {
    children.push(sectionHeader("PORTFOLIO — PRODUCTION SITES"));
    const runs: (TextRun | ExternalHyperlink)[] = [];
    data.portfolioSites.forEach((site, i) => {
      if (i > 0) {
        runs.push(
          new TextRun({ text: "  |  ", bold: true, size: 21, font: FONT })
        );
      }
      runs.push(
        new ExternalHyperlink({
          link: `https://${site}`,
          children: [
            new TextRun({
              text: site,
              style: "Hyperlink",
              size: 21,
              font: FONT,
            }),
          ],
        })
      );
    });
    children.push(new Paragraph({ spacing: { after: 200 }, children: runs }));
  }

  if (data.education?.length) {
    children.push(sectionHeader("EDUCATION"));
    data.education.forEach((e, i) =>
      children.push(
        new Paragraph({
          spacing: {
            after: i === data.education!.length - 1 ? 140 : 40,
          },
          children: [new TextRun({ text: e, size: 21, font: FONT })],
        })
      )
    );
  }

  if (data.certifications?.length) {
    children.push(sectionHeader("CERTIFICATIONS"));
    for (const c of data.certifications) {
      children.push(
        new Paragraph({
          spacing: { after: 40 },
          children: [new TextRun({ text: c, size: 21, font: FONT })],
        })
      );
    }
  }

  return new Document({
    numbering: {
      config: [
        {
          reference: "bullet-list",
          levels: [
            {
              level: 0,
              format: "bullet",
              text: "•",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: 360, hanging: 260 } },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 720, bottom: 720, left: 810, right: 810 },
          },
        },
        children,
      },
    ],
  });
}

export type JsonDocxBuildResult =
  | { ok: true; buffer: Buffer; builderVersion: string }
  | { ok: false; error: string };

/**
 * Sanitize curated/master CV JSON and pack a US-Letter .docx buffer.
 * Caller should schema-validate before calling (U6); this still guards shape minimally.
 */
export async function buildJsonDocx(data: unknown): Promise<JsonDocxBuildResult> {
  try {
    const sanitized = sanitizeCvJson(data);
    const cv = asResumeCv(sanitized);
    const doc = buildDocument(cv);
    const buffer = Buffer.from(await Packer.toBuffer(doc));
    return { ok: true, buffer, builderVersion: BUILDER_VERSION };
  } catch (err) {
    const message = err instanceof Error ? err.message : "docx build failed";
    return { ok: false, error: message };
  }
}

export async function buildJsonDocxBase64(
  data: unknown
): Promise<
  | { ok: true; base64: string; builderVersion: string }
  | { ok: false; error: string }
> {
  const result = await buildJsonDocx(data);
  if (!result.ok) return result;
  return {
    ok: true,
    base64: result.buffer.toString("base64"),
    builderVersion: result.builderVersion,
  };
}
