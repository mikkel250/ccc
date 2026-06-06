import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
  },
  // No browser projects — API-only testing uses the `request` fixture
});
