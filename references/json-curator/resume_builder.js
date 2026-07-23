/**
 * resume_builder.js
 *
 * Reusable docx-js template matching the style of the baseline CV.
 * Usage: node resume_builder.js <input.json> <output.docx>
 *
 * The input JSON should match the shape of master_cv.json (or a curated
 * subset of it — same schema, fewer bullets/roles/entries).
 *
 * Style spec extracted from the baseline docx:
 *   - Page: US Letter (12240 x 15840 DXA), margins 720 top/bottom, 810 left/right
 *   - Font: Times New Roman (docDefault, no per-run override in source)
 *   - Name: 20pt bold, centered
 *   - Contact line: 9.5pt, color #333333, centered, pipe-separated
 *   - Section headers: 16pt bold, bottom border (single, 0.75pt, #1A2B4C)
 *   - Job header: title | location | dates on one line, pipe-separated
 *   - Company blurb: italic, #333333
 *   - Bullets: 10.5pt, standard bullet list
 */

const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  BorderStyle, ExternalHyperlink,
} = require("docx");

const COLOR_MUTED = "333333";
const COLOR_BORDER = "1A2B4C";
const FONT = "Times New Roman";

// ---- shared style bits ----

function sectionHeader(text) {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: COLOR_BORDER, space: 1 } },
    spacing: { before: 240, after: 100 },
    children: [new TextRun({ text, bold: true, size: 32, font: FONT })],
  });
}

function bullet(text, opts = {}) {
  return new Paragraph({
    numbering: { reference: "bullet-list", level: 0 },
    spacing: { after: opts.after || 60 },
    children: [new TextRun({ text, size: 21, font: FONT })],
  });
}

function linkRun(label, url) {
  return new ExternalHyperlink({
    link: url,
    children: [new TextRun({ text: label, style: "Hyperlink", size: 19, font: FONT })],
  });
}

function contactLine(contact) {
  const runs = [
    new TextRun({ text: `${contact.location}  |  ${contact.phone}  |  `, color: COLOR_MUTED, bold: true, size: 19, font: FONT }),
    linkRun(contact.email, `mailto:${contact.email}`),
  ];
  for (const l of contact.links) {
    runs.push(new TextRun({ text: "  |  ", color: COLOR_MUTED, bold: true, size: 19, font: FONT }));
    runs.push(linkRun(l.label, l.url));
  }
  return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: runs });
}

function jobHeader(title, location, dates) {
  const runs = [new TextRun({ text: title, bold: true, size: 21, font: FONT })];
  for (const part of [location, dates].filter(Boolean)) {
    runs.push(new TextRun({ text: " | ", size: 21, font: FONT }));
    runs.push(new TextRun({ text: part, color: COLOR_MUTED, size: 21, font: FONT }));
  }
  return new Paragraph({ spacing: { after: 40 }, children: runs });
}

function blurb(text) {
  return new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text, italics: true, color: COLOR_MUTED, size: 21, font: FONT })],
  });
}

function subroleHeading(text) {
  return new Paragraph({
    spacing: { before: 40, after: 40 },
    children: [new TextRun({ text, bold: true, italics: true, size: 21, font: FONT })],
  });
}

// ---- main build ----

function buildResume(data) {
  const children = [];

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 240, after: 100 },
    children: [new TextRun({ text: data.name, bold: true, size: 40, font: FONT })],
  }));
  children.push(contactLine(data.contact));

  if (data.summary && data.summary.length) {
    children.push(sectionHeader("SUMMARY"));
    data.summary.forEach((s) => children.push(bullet(s)));
  }

  if (data.skills && data.skills.length) {
    children.push(sectionHeader("TECHNICAL SKILLS"));
    data.skills.forEach((s) => {
      children.push(new Paragraph({
        spacing: { after: 60 },
        children: [
          new TextRun({ text: `${s.category}: `, bold: true, size: 21, font: FONT }),
          new TextRun({ text: s.items, size: 21, font: FONT }),
        ],
      }));
    });
  }

  if (data.experience && data.experience.length) {
    children.push(sectionHeader("PROFESSIONAL EXPERIENCE"));
    data.experience.forEach((role) => {
      children.push(jobHeader(role.title, role.location, role.dates));
      if (role.blurb) children.push(blurb(role.blurb));
      if (role.subroles) {
        role.subroles.forEach((sr) => {
          children.push(subroleHeading(sr.heading));
          sr.bullets.forEach((b) => children.push(bullet(b)));
        });
      } else if (role.bullets) {
        role.bullets.forEach((b, i) => children.push(bullet(b, { after: i === role.bullets.length - 1 ? 140 : 60 })));
      }
    });
  }

  if (data.projects && data.projects.length) {
    children.push(sectionHeader("PROJECTS"));
    data.projects.forEach((p) => {
      const headingChildren = [
        new TextRun({
          text: p.linkUrl && p.linkLabel ? `${p.name} — ` : p.name,
          bold: true,
          size: 21,
          font: FONT,
        }),
      ];
      if (p.linkUrl && p.linkLabel) {
        headingChildren.push(
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
          })
        );
      }
      children.push(
        new Paragraph({
          spacing: { after: 40 },
          children: headingChildren,
        })
      );
      p.bullets.forEach((b) => children.push(bullet(b, { after: 100 })));
    });
  }

  if (data.portfolioSites && data.portfolioSites.length) {
    children.push(sectionHeader("PORTFOLIO — PRODUCTION SITES"));
    const runs = [];
    data.portfolioSites.forEach((site, i) => {
      if (i > 0) runs.push(new TextRun({ text: "  |  ", bold: true, size: 21, font: FONT }));
      runs.push(new ExternalHyperlink({
        link: `https://${site}`,
        children: [new TextRun({ text: site, style: "Hyperlink", size: 21, font: FONT })],
      }));
    });
    children.push(new Paragraph({ spacing: { after: 200 }, children: runs }));
  }

  if (data.education && data.education.length) {
    children.push(sectionHeader("EDUCATION"));
    data.education.forEach((e, i) => children.push(new Paragraph({
      spacing: { after: i === data.education.length - 1 ? 140 : 40 },
      children: [new TextRun({ text: e, size: 21, font: FONT })],
    })));
  }

  if (data.certifications && data.certifications.length) {
    children.push(sectionHeader("CERTIFICATIONS"));
    data.certifications.forEach((c) => children.push(new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: c, size: 21, font: FONT })],
    })));
  }

  return new Document({
    numbering: {
      config: [{
        reference: "bullet-list",
        levels: [{ level: 0, format: "bullet", text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 360, hanging: 260 } } } }],
      }],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 720, bottom: 720, left: 810, right: 810 },
        },
      },
      children,
    }],
  });
}

// ---- CLI ----

const [,, inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error("Usage: node resume_builder.js <input.json> <output.docx>");
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const doc = buildResume(data);
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outputPath, buf);
  console.log(`Wrote ${outputPath}`);
});

