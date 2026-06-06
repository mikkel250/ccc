import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scoreFormatCompliance } from "../app/api/lib/eval-format";
import { FormatSection } from "../app/api/lib/eval-schema";

const STRUAN_EIGHT_PART_SECTIONS = [
  "Contact Information",
  "Objective Value Statement",
  "Relevant Accomplishments",
  "Technical Skills",
  "Standard Job Information",
  "Company Summaries",
  "Measurable Accomplishments",
  "Education",
] as const;

const SECTION_CONTENT: Record<string, string> = {
  "Contact Information": "San Francisco, CA | email@example.com",
  "Objective Value Statement":
    "10+ years building full-stack platforms at growth-stage companies.",
  "Relevant Accomplishments":
    "- Led migration to React\n- Reduced deploy time 40%",
  "Technical Skills": "TypeScript, React, Node.js, PostgreSQL",
  "Standard Job Information":
    "### Acme Corp\nSenior Engineer | Remote | Jan 2020 – Present",
  "Company Summaries":
    "Acme Corp — B2B SaaS, ~200 employees, US/EU.",
  "Measurable Accomplishments":
    "- Shipped billing revamp used by 5k accounts",
  Education: "BS Computer Science, Example University",
};

function buildCv(
  sections: Array<{ title: string; body?: string }>,
  options: { candidateName?: string } = {}
): string {
  const { candidateName = "Jane Example" } = options;
  const sectionBlocks = sections
    .map(({ title, body = "Content present." }) => `## ${title}\n${body}`)
    .join("\n\n");
  return `# ${candidateName}\n\n${sectionBlocks}`;
}

function buildCanonicalCv(): string {
  return buildCv(
    Object.entries(SECTION_CONTENT).map(([title, body]) => ({ title, body }))
  );
}

const ALL_SECTION_TITLES = Object.values(FormatSection);

describe("scoreFormatCompliance", () => {
  it("canonical well-formed CV returns score 1.0 with all booleans true", () => {
    const result = scoreFormatCompliance(buildCanonicalCv());
    assert.equal(result.score, 1.0);
    for (const section of ALL_SECTION_TITLES) {
      assert.equal(result.breakdown[section], true, `expected ${section} present`);
    }
    assert.ok(result.details.length >= 0);
  });

  it("each single missing section returns correct score and per-section breakdown", () => {
    for (const missing of ALL_SECTION_TITLES) {
      const sections = ALL_SECTION_TITLES.filter((s) => s !== missing).map(
        (title) => ({ title, body: SECTION_CONTENT[title] })
      );
      const result = scoreFormatCompliance(buildCv(sections));
      assert.equal(result.breakdown[missing], false, `missing ${missing}`);
      assert.ok(result.score < 1.0, `score should drop when ${missing} is missing`);
      assert.ok(result.score >= 0.0 && result.score <= 1.0);
      const presentCount = ALL_SECTION_TITLES.filter(
        (s) => s !== missing && result.breakdown[s]
      ).length;
      assert.ok(presentCount >= 7, "seven of eight sections should be detected");
    }
  });

  it("sections in wrong order returns all present but score < 1.0 with order violation details", () => {
    const reversed = [...ALL_SECTION_TITLES].reverse().map((title) => ({
      title,
      body: SECTION_CONTENT[title],
    }));
    const result = scoreFormatCompliance(buildCv(reversed));
    for (const section of ALL_SECTION_TITLES) {
      assert.equal(result.breakdown[section], true, `${section} should be detected`);
    }
    assert.ok(result.score < 1.0, "wrong order must penalize score");
    assert.ok(
      result.details.some((d) => /order|sequence|out of order/i.test(d)),
      `expected order violation in details: ${result.details.join("; ")}`
    );
  });

  it("empty input returns score 0.0 with all booleans false", () => {
    const result = scoreFormatCompliance("");
    assert.equal(result.score, 0.0);
    for (const section of ALL_SECTION_TITLES) {
      assert.equal(result.breakdown[section], false);
    }
  });

  it("extra headings beyond 8 sections returns score < 1.0 with appropriate details", () => {
    const cv = `${buildCanonicalCv()}\n\n## Fabricated Awards Section\n- Won fake prize`;
    const result = scoreFormatCompliance(cv);
    assert.ok(result.score < 1.0);
    assert.ok(
      result.details.some((d) => /extra|unknown|fabricat|unexpected/i.test(d)),
      `expected extra section noted: ${result.details.join("; ")}`
    );
  });

  it("CV with only heading names and no body content still scores 1.0", () => {
    const headingsOnly = buildCv(
      ALL_SECTION_TITLES.map((title) => ({ title, body: "" }))
    );
    const result = scoreFormatCompliance(headingsOnly);
    assert.equal(result.score, 1.0);
    for (const section of ALL_SECTION_TITLES) {
      assert.equal(result.breakdown[section], true);
    }
  });

  it("malformed markdown with no proper headings returns score 0.0", () => {
    const result = scoreFormatCompliance(
      "This is plain text without any markdown headings at all."
    );
    assert.equal(result.score, 0.0);
    for (const section of ALL_SECTION_TITLES) {
      assert.equal(result.breakdown[section], false);
    }
  });

  it("score is always in range 0.0–1.0", () => {
    const inputs = [
      "",
      buildCanonicalCv(),
      "# Random\nOnly one section",
      buildCv([{ title: "Contact Information", body: "x" }]),
    ];
    for (const input of inputs) {
      const result = scoreFormatCompliance(input);
      assert.ok(result.score >= 0.0 && result.score <= 1.0, `score out of range for input`);
    }
  });

  it("case-insensitive section matching", () => {
    const mixedCase = buildCv(
      ALL_SECTION_TITLES.map((title) => ({
        title: title.toUpperCase(),
        body: SECTION_CONTENT[title],
      }))
    );
    const result = scoreFormatCompliance(mixedCase);
    assert.equal(result.score, 1.0);
    for (const section of ALL_SECTION_TITLES) {
      assert.equal(result.breakdown[section], true);
    }
  });

  it("pipeline-shaped CV with ## section headings and ### company subheadings passes structure check", () => {
    const pipelineCv = `# Jane Example

## Contact Information
City, State | LinkedIn

## Objective Value Statement
Senior engineer with platform experience.

## Relevant Accomplishments
- Tailored bullet for JD

## Technical Skills
TypeScript, React

## Standard Job Information
### Example Corp
Engineer | Remote | 2020 – Present

## Company Summaries
Example Corp — SaaS, 500 employees.

## Measurable Accomplishments
- Improved uptime to 99.9%

## Education
BS CS, State University
`;
    const result = scoreFormatCompliance(pipelineCv);
    assert.equal(result.score, 1.0);
    for (const section of ALL_SECTION_TITLES) {
      assert.equal(result.breakdown[section], true);
    }
  });

  it("CV with only ## section headings (cv-prompt contract) scores 1.0 without h1 section headings", () => {
    const promptShapedCv = buildCanonicalCv();
    assert.match(promptShapedCv, /^# Jane Example\n\n## Contact Information/m);
    const result = scoreFormatCompliance(promptShapedCv);
    assert.equal(result.score, 1.0);
    for (const section of ALL_SECTION_TITLES) {
      assert.equal(result.breakdown[section], true, `expected ${section} from ## headings`);
    }
  });
});
