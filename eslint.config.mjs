import { defineConfig, globalIgnores } from "eslint/config";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

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
    patterns: [
      {
        group: ["@jest/**", "jest/**", "vitest/**"],
        message: "Use node:test and node:assert/strict.",
      },
      {
        group: ["sinon/**"],
        message:
          "Use node:test mock.method or optional function-parameter injection.",
      },
    ],
  },
];

// eslint-config-next@15 (matching Next 15) — no ESM flat export; use FlatCompat.
const eslintConfig = defineConfig([
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "references/**",
  ]),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: [
      "app/**/*.ts",
      "lib/**/*.ts",
      "scripts/**/*.ts",
      "instrumentation.ts",
      "instrumentation.node.ts",
    ],
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
