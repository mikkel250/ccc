import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const WORKFLOW_PATH = join(ROOT, ".github", "workflows", "ci.yml");

function uncommentedYaml(yaml: string): string {
  return yaml
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

type Yaml = string | Yaml[] | { [key: string]: Yaml } | null;
type YamlMap = { [key: string]: Yaml };

function unquoteYaml(raw: string): string {
  const trimmed = raw.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function workflowLines(yaml: string): Array<{ indent: number; content: string }> {
  return yaml.split(/\r?\n/).flatMap((line) => {
    if (line.trim() === "" || line.trim().startsWith("#")) return [];
    return [{ indent: line.match(/^ */)?.[0].length ?? 0, content: line.trim() }];
  });
}

function parseWorkflowYaml(yaml: string): YamlMap {
  const parsed = parseBlock(workflowLines(yaml), 0, 0);
  if (parsed.value === null || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    throw new Error("workflow YAML root must be a mapping");
  }
  return parsed.value;
}

function parseBlock(
  lines: Array<{ indent: number; content: string }>,
  start: number,
  indent: number
): { value: Yaml; next: number } {
  if (start >= lines.length) return { value: null, next: start };
  if (lines[start]?.content.startsWith("- ")) return parseSequence(lines, start, indent);
  return parseMap(lines, start, indent);
}

function parseMap(
  lines: Array<{ indent: number; content: string }>,
  start: number,
  indent: number
): { value: YamlMap; next: number } {
  const map: YamlMap = {};
  let index = start;
  while (index < lines.length && lines[index]?.indent === indent && !lines[index]?.content.startsWith("- ")) {
    const content = lines[index]?.content ?? "";
    const colon = content.indexOf(":");
    if (colon <= 0) throw new Error(`invalid workflow YAML line: ${content}`);
    const key = content.slice(0, colon).trim();
    const rest = content.slice(colon + 1).trim();
    if (rest === "" || rest === "|" || rest === ">" || rest === "|-" || rest === ">-") {
      const next = lines[index + 1];
      if (next && next.indent > indent) {
        const child = parseBlock(lines, index + 1, next.indent);
        map[key] = child.value;
        index = child.next;
      } else {
        map[key] = null;
        index += 1;
      }
    } else {
      map[key] = unquoteYaml(rest);
      index += 1;
    }
  }
  return { value: map, next: index };
}

function parseSequence(
  lines: Array<{ indent: number; content: string }>,
  start: number,
  indent: number
): { value: Yaml[]; next: number } {
  const items: Yaml[] = [];
  let index = start;
  while (index < lines.length && lines[index]?.indent === indent && lines[index]?.content.startsWith("- ")) {
    const rest = lines[index]?.content.slice(2).trim() ?? "";
    const colon = rest.indexOf(":");
    if (colon === -1) {
      items.push(unquoteYaml(rest));
      index += 1;
      continue;
    }
    const key = rest.slice(0, colon).trim();
    const valueRest = rest.slice(colon + 1).trim();
    const item: YamlMap = {};
    if (valueRest === "" || valueRest === "|" || valueRest === ">") {
      const next = lines[index + 1];
      if (next && next.indent > indent) {
        const child = parseBlock(lines, index + 1, next.indent);
        item[key] = child.value;
        index = child.next;
      } else {
        item[key] = null;
        index += 1;
      }
    } else {
      item[key] = unquoteYaml(valueRest);
      index += 1;
      const next = lines[index];
      if (next && next.indent > indent && !next.content.startsWith("- ")) {
        const child = parseMap(lines, index, next.indent);
        Object.assign(item, child.value);
        index = child.next;
      }
    }
    items.push(item);
  }
  return { value: items, next: index };
}

function yamlMap(value: Yaml | undefined): YamlMap | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value;
  return undefined;
}

function yamlScalars(value: Yaml | undefined): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      return trimmed
        .slice(1, -1)
        .split(",")
        .map((part) => unquoteYaml(part))
        .filter((part) => part !== "");
    }
    return trimmed === "" ? [] : [trimmed];
  }
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

function pushBranches(doc: YamlMap): string[] {
  return yamlScalars(yamlMap(yamlMap(doc.on)?.push)?.branches);
}

function permissionContents(permissions: Yaml | undefined): string {
  if (permissions === "read-all") return "read";
  if (permissions === "write-all") return "write";
  if (typeof permissions === "string") return "none";
  const contents = yamlMap(permissions)?.contents;
  return typeof contents === "string" ? contents : "none";
}

/** Job permissions replace workflow permissions; a missing job block inherits. */
function effectiveCheckContents(doc: YamlMap): string {
  const check = yamlMap(yamlMap(doc.jobs)?.check);
  if (check && Object.prototype.hasOwnProperty.call(check, "permissions")) {
    return permissionContents(check.permissions);
  }
  if (Object.prototype.hasOwnProperty.call(doc, "permissions")) {
    return permissionContents(doc.permissions);
  }
  return "write";
}

describe("GitHub Actions CI workflow", () => {
  it("checks out, installs, lints, tests, and builds on PRs and main", () => {
    assert.ok(
      existsSync(WORKFLOW_PATH),
      ".github/workflows/ci.yml must exist so pull requests are gated"
    );
    const yaml = uncommentedYaml(readFileSync(WORKFLOW_PATH, "utf8"));
    const doc = parseWorkflowYaml(yaml);

    assert.match(yaml, /pull_request:/);
    assert.match(yaml, /push:/);
    assert.ok(pushBranches(doc).includes("main"));
    assert.equal(
      pushBranches(parseWorkflowYaml("on:\n  push:\n    branches:\n      - main-dev\n")).includes("main"),
      false
    );
    assert.match(yaml, /node-version-file:\s*\.nvmrc/);
    assert.match(yaml, /npm ci\b/);
    assert.match(yaml, /npm run lint\b/);
    assert.match(yaml, /npm test\b/);
    assert.match(yaml, /npm run build\b/);
  });

  it("does not run live-secret jobs (smoke, Playwright, inbox Redis)", () => {
    assert.ok(existsSync(WORKFLOW_PATH), ".github/workflows/ci.yml must exist");
    const yaml = uncommentedYaml(readFileSync(WORKFLOW_PATH, "utf8"));

    assert.equal(/npm run smoke\b/.test(yaml), false);
    assert.equal(/npm run test:e2e\b/.test(yaml), false);
    assert.equal(/RUN_INBOX_REDIS_TESTS/.test(yaml), false);
    assert.equal(/TAILOR_API_KEY/.test(yaml), false);
  });

  it("limits the check job token to contents read", () => {
    assert.ok(existsSync(WORKFLOW_PATH), ".github/workflows/ci.yml must exist");
    const doc = parseWorkflowYaml(uncommentedYaml(readFileSync(WORKFLOW_PATH, "utf8")));
    const workflowContents = yamlMap(doc.permissions)?.contents;
    const checkPermissions = yamlMap(yamlMap(doc.jobs)?.check)?.permissions;

    assert.equal(workflowContents, "read");
    if (checkPermissions !== undefined) {
      assert.equal(permissionContents(checkPermissions), "read");
    }
    assert.equal(effectiveCheckContents(doc), "read");
    assert.equal(
      effectiveCheckContents(parseWorkflowYaml(
        "permissions:\n  contents: read\njobs:\n  check:\n    permissions:\n      contents: write\n"
      )),
      "write"
    );
    assert.equal(
      effectiveCheckContents(parseWorkflowYaml(
        "permissions:\n  contents: write\njobs:\n  check:\n    permissions:\n      contents: read\n"
      )),
      "read"
    );
  });
});
