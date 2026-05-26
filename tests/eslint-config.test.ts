import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = join(import.meta.dirname, "..");

function readPackageJson(): {
  scripts?: { lint?: string };
  devDependencies?: Record<string, string>;
} {
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
}

describe("eslint flat config (Next.js 16)", () => {
  it("has eslint.config.mjs at project root", () => {
    assert.ok(
      existsSync(join(root, "eslint.config.mjs")),
      "eslint.config.mjs must exist for Next.js 16 ESLint flat config"
    );
  });

  it('uses eslint CLI in package.json lint script (not "next lint")', () => {
    const pkg = readPackageJson();
    assert.equal(
      pkg.scripts?.lint,
      "eslint .",
      'lint script must be "eslint ." — next lint is removed in Next.js 16'
    );
  });

  it("declares eslint and eslint-config-next as devDependencies", () => {
    const pkg = readPackageJson();
    assert.ok(pkg.devDependencies?.eslint, "eslint must be a devDependency");
    assert.ok(
      pkg.devDependencies?.["eslint-config-next"],
      "eslint-config-next must be a devDependency"
    );
  });

  it("eslint.config.mjs exports flat config using eslint-config-next", () => {
    const configPath = join(root, "eslint.config.mjs");
    assert.ok(existsSync(configPath), "eslint.config.mjs must exist");
    const content = readFileSync(configPath, "utf8");
    assert.match(content, /eslint-config-next/);
    assert.match(content, /export default/);
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
});
