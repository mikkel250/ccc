import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compileCvPrompt,
  getCvPromptFallbackText,
} from "../app/api/lib/cv-prompt";

/** Sam Struan 8-part framework — canonical section order for fallback prompt contract */
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

const LEGACY_FOUR_PART_HEADINGS = [
  "# Summary",
  "## Experience",
  "## Skills",
  "## Projects",
] as const;

function sectionIndex(prompt: string, section: string): number {
  return prompt.toLowerCase().indexOf(section.toLowerCase());
}

describe("getCvPromptFallbackText — Struan 8-part schema", () => {
  it("exposes the hardcoded fallback prompt for contract tests", () => {
    const prompt = getCvPromptFallbackText();
    assert.equal(typeof prompt, "string");
    assert.ok(prompt.length > 500, "fallback prompt should be substantial");
  });

  it("names all eight Struan sections in prescribed order", () => {
    const prompt = getCvPromptFallbackText();
    let lastIndex = -1;

    for (const section of STRUAN_EIGHT_PART_SECTIONS) {
      const idx = sectionIndex(prompt, section);
      assert.ok(idx >= 0, `missing section "${section}" in fallback prompt`);
      assert.ok(
        idx > lastIndex,
        `section "${section}" must appear after prior sections`
      );
      lastIndex = idx;
    }
  });

  it("requires markdown heading syntax for each of the eight parts", () => {
    const prompt = getCvPromptFallbackText();
    assert.match(
      prompt,
      /#+\s*(Contact Information|Objective Value Statement)/i,
      "prompt must document # or ## heading syntax for top sections"
    );
    assert.match(
      prompt,
      /(`#`|"##"|`##`|heading|top-level)/i,
      "prompt must instruct strict heading levels for section separation"
    );
  });

  it("does not prescribe the legacy four-part Summary/Experience/Skills/Projects schema", () => {
    const prompt = getCvPromptFallbackText();
    for (const legacy of LEGACY_FOUR_PART_HEADINGS) {
      assert.ok(
        !prompt.includes(legacy),
        `fallback must not require legacy heading ${legacy}`
      );
    }
    assert.ok(
      !/Use exactly these top-level sections/i.test(prompt) ||
        !prompt.includes("# Summary"),
      "fallback must not list # Summary as a required top-level section"
    );
  });
});

describe("getCvPromptFallbackText — section content guardrails", () => {
  it("Contact Information: location, email, LinkedIn, optional portfolio/GitHub", () => {
    const prompt = getCvPromptFallbackText();
    assert.match(prompt, /contact/i);
    assert.match(prompt, /(city|location|state)/i);
    assert.match(prompt, /email/i);
    assert.match(prompt, /linkedin/i);
    assert.match(prompt, /(portfolio|github)/i);
  });

  it("Objective Value Statement: experience years, roles, company scale", () => {
    const prompt = getCvPromptFallbackText();
    assert.match(prompt, /objective value statement/i);
    assert.match(prompt, /(years of experience|years)/i);
    assert.match(prompt, /(roles|responsibilities)/i);
    assert.match(prompt, /(headcount|revenue|employees)/i);
  });

  it("Relevant Accomplishments: 2–3 tailored highlights, primary tailoring target", () => {
    const prompt = getCvPromptFallbackText();
    assert.match(prompt, /relevant accomplishments/i);
    assert.match(prompt, /(2.?3|two|three).*(accomplish|experience|highlight)/i);
    assert.match(
      prompt,
      /(tailor|only section|per application)/i,
      "prompt should state Relevant Accomplishments is the main per-JD tailoring section"
    );
  });

  it("Technical Skills: software/platforms/tools, avoid generic soft skills", () => {
    const prompt = getCvPromptFallbackText();
    assert.match(prompt, /technical skills/i);
    assert.match(prompt, /(software|platform|tool)/i);
    assert.match(
      prompt,
      /(avoid|do not|not include).*(communication|stakeholder|soft|generic)/i
    );
  });

  it("Standard Job Information: company, title, location, dates with months", () => {
    const prompt = getCvPromptFallbackText();
    assert.match(prompt, /standard job information/i);
    assert.match(prompt, /company/i);
    assert.match(prompt, /title/i);
    assert.match(prompt, /location/i);
    assert.match(prompt, /(dates|months)/i);
  });

  it("Company Summaries: 1–2 lines on what company does, size, revenue, geography", () => {
    const prompt = getCvPromptFallbackText();
    assert.match(prompt, /company summar/i);
    assert.match(prompt, /(1.?2|one|two).*(line|sentence)/i);
    assert.match(prompt, /(revenue|size|geograph|what the company)/i);
  });

  it("Measurable Accomplishments: scope, impact, scale, quantified outcomes", () => {
    const prompt = getCvPromptFallbackText();
    assert.match(prompt, /measurable accomplishments/i);
    assert.match(prompt, /(scope|impact|scale|outcome|metric)/i);
  });

  it("Education: optional when absent from CONTEXT", () => {
    const prompt = getCvPromptFallbackText();
    assert.match(prompt, /education/i);
    assert.match(
      prompt,
      /(omit|if applicable|no relevant|no grounded)/i,
      "prompt should allow omitting Education when CONTEXT has none"
    );
  });
});

describe("getCvPromptFallbackText — output and anti-hallucination guardrails", () => {
  it("requires strict Markdown only output", () => {
    const prompt = getCvPromptFallbackText();
    assert.match(prompt, /strict\s+markdown/i);
  });

  it("forbids HTML, tables, code fences, and JSON", () => {
    const prompt = getCvPromptFallbackText();
    assert.match(prompt, /(no html|without html|never html)/i);
    assert.match(prompt, /(no table|without table)/i);
    assert.match(prompt, /(no code fence|code fences|```)/);
    assert.match(prompt, /(no json|without json)/i);
  });

  it("enforces CONTEXT-only facts with no fabrication", () => {
    const prompt = getCvPromptFallbackText();
    assert.match(prompt, /(only|never invent|do not invent|non-negotiable)/i);
    assert.match(prompt, /\{?\{?CONTEXT\}?\}?/);
    assert.match(prompt, /(hallucinat|fabricat|invent)/i);
  });

  it("compileCvPrompt substitutes CONTEXT in the fallback template", () => {
    const prompt = getCvPromptFallbackText();
    const context = "KB: experience at Acme Corp, 2020–2024";
    const compiled = compileCvPrompt(prompt, context);
    assert.ok(compiled.includes(context));
    assert.ok(!compiled.includes("{{CONTEXT}}"));
    assert.ok(!/\{CONTEXT\}/.test(compiled));
  });
});
