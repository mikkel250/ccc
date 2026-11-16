import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readPackageJson(): {
  dependencies?: Record<string, string>;
  scripts?: { lint?: string };
  devDependencies?: Record<string, string>;
} {
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
}

function installedVersion(pkgName: string): string {
  const pkg = JSON.parse(
    readFileSync(join(root, "node_modules", pkgName, "package.json"), "utf8")
  ) as { version: string };
  assert.ok(pkg.version, `${pkgName} must declare a version`);
  return pkg.version;
}

function majorFromSpec(spec: string): string {
  const match = spec.match(/(\d+)/);
  assert.ok(match, `could not parse major version from ${spec}`);
  return match[1]!;
}

describe("eslint flat config (Next.js 15)", () => {
  it("has eslint.config.mjs at project root", () => {
    assert.ok(
      existsSync(join(root, "eslint.config.mjs")),
      "eslint.config.mjs must exist for Next.js 15 ESLint flat config"
    );
  });

  it('uses eslint CLI in package.json lint script (not "next lint")', () => {
    const pkg = readPackageJson();
    assert.equal(
      pkg.scripts?.lint,
      "eslint .",
      'lint script must be "eslint ." — next lint is deprecated in Next.js 15.5'
    );
  });

  it("declares eslint, eslint-config-next, and @eslint/eslintrc as devDependencies", () => {
    const pkg = readPackageJson();
    assert.ok(pkg.devDependencies?.eslint, "eslint must be a devDependency");
    assert.ok(
      pkg.devDependencies?.["eslint-config-next"],
      "eslint-config-next must be a devDependency"
    );
    assert.ok(
      pkg.devDependencies?.["@eslint/eslintrc"],
      "@eslint/eslintrc must be a direct devDependency for Next 15 FlatCompat"
    );
  });

  it("pins eslint-config-next to the same major as next (15)", () => {
    const pkg = readPackageJson();
    const nextSpec = pkg.dependencies?.next;
    const eslintConfigNextSpec = pkg.devDependencies?.["eslint-config-next"];
    assert.ok(nextSpec, "next must be a dependency");
    assert.ok(eslintConfigNextSpec, "eslint-config-next must be a devDependency");

    const nextMajor = majorFromSpec(nextSpec);
    const eslintConfigNextMajor = majorFromSpec(eslintConfigNextSpec);
    assert.equal(nextMajor, "15", `next must stay on 15.x (got ${nextSpec})`);
    assert.equal(
      eslintConfigNextMajor,
      nextMajor,
      `eslint-config-next ${eslintConfigNextSpec} must match next ${nextSpec} major`
    );

    const nextInstalled = installedVersion("next");
    const eslintConfigNextInstalled = installedVersion("eslint-config-next");
    assert.equal(
      majorFromSpec(nextInstalled),
      "15",
      `installed next must be 15.x (got ${nextInstalled})`
    );
    assert.equal(
      majorFromSpec(eslintConfigNextInstalled),
      "15",
      `installed eslint-config-next must be 15.x (got ${eslintConfigNextInstalled})`
    );
  });

  it("eslint.config.mjs uses Next 15 FlatCompat, not the Next 16 ESM export", () => {
    const configPath = join(root, "eslint.config.mjs");
    assert.ok(existsSync(configPath), "eslint.config.mjs must exist");
    const content = readFileSync(configPath, "utf8");
    assert.match(content, /eslint-config-next/);
    assert.match(content, /export default/);
    assert.match(content, /FlatCompat/);
    assert.match(content, /@eslint\/eslintrc/);
    assert.match(content, /next\/core-web-vitals/);
    assert.doesNotMatch(
      content,
      /from ["']eslint-config-next\/core-web-vitals["']/,
      "Next 15 eslint-config-next has no flat-config ESM export at eslint-config-next/core-web-vitals"
    );
    assert.match(
      content,
      /@typescript-eslint\/no-explicit-any/,
      "production TypeScript must lint-ban explicit any"
    );
    assert.match(
      content,
      /no-restricted-imports/,
      "lint must ban Jest/Vitest/Sinon imports"
    );
  });

  it("npm run lint runs without ESLint config-not-found error", () => {
    const result = spawnSync("npm", ["run", "lint"], {
      cwd: root,
      encoding: "utf8",
      shell: true,
    });

    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

    assert.doesNotMatch(
      output,
      /couldn't find.*eslint config/i,
      "lint must not fail because ESLint config file is missing"
    );
    assert.doesNotMatch(
      output,
      /No ESLint configuration found/i,
      "lint must not fail with no configuration found"
    );
    assert.doesNotMatch(
      output,
      /ESLint couldn't find a configuration file/i,
      "lint must not fail with missing configuration file"
    );

    if (/eslint: command not found|Cannot find module 'eslint'/i.test(output)) {
      assert.fail("eslint must be installed and runnable via npm run lint");
    }

    assert.equal(
      result.status,
      0,
      `npm run lint must exit 0; output:\n${output}`
    );
  });

  it("bans test-framework package and subpath imports in app and tests", async () => {
    const eslint = new ESLint({ cwd: root });
    const banned = [
      ["app/api/lib/sample.ts", 'import "@jest/globals";\n'],
      ["app/api/lib/sample.ts", 'import "vitest/config";\n'],
      ["app/api/lib/sample.ts", 'import "jest";\n'],
      ["app/api/lib/sample.ts", 'import "sinon/pkg/sinon.js";\n'],
      ["tests/sample.test.ts", 'import "@jest/globals";\n'],
      ["tests/sample.test.ts", 'import "vitest/config";\n'],
      ["tests/sample.test.ts", 'import "vitest";\n'],
      ["tests/sample.test.ts", 'import "sinon";\n'],
    ] as const;

    for (const [filePath, code] of banned) {
      const messages = await restrictedImportMessages(eslint, filePath, code);
      assert.ok(
        messages.length > 0,
        `${filePath} must restrict ${code.trim()}`
      );
    }

    const allowed = await restrictedImportMessages(
      eslint,
      "tests/sample.test.ts",
      'import { test } from "node:test";\nimport assert from "node:assert/strict";\n'
    );
    assert.deepEqual(allowed, []);
  });
});

async function restrictedImportMessages(
  eslint: ESLint,
  filePath: string,
  code: string
): Promise<string[]> {
  const results = await eslint.lintText(code, { filePath });
  const messages: string[] = [];
  for (const result of results) {
    for (const message of result.messages) {
      if (message.ruleId === "no-restricted-imports") {
        messages.push(message.message);
      }
    }
  }
  return messages;
}
