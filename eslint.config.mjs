import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import tseslint from "typescript-eslint";

const noTestFrameworkImports = [
  "error",
  {
    paths: [
      {
        name: "jest",
        message: "Use node:test and node:assert/strict.",
      },
      {
        name: "vitest",
        message: "Use node:test and node:assert/strict.",
      },
      {
        name: "sinon",
        message: "Use node:test mock.method or optional function-parameter injection.",
      },
    ],
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: [
      "app/**/*.ts",
      "lib/**/*.ts",
      "scripts/**/*.ts",
      "instrumentation.ts",
      "instrumentation.node.ts",
    ],
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "no-restricted-imports": noTestFrameworkImports,
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "no-restricted-imports": noTestFrameworkImports,
    },
  },
]);

export default eslintConfig;
