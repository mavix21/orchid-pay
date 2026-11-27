import { defineConfig, devices } from "@playwright/test";

import { e2eDatabaseUrl } from "./e2e/database";

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/database.ts",
  timeout: 120_000,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:4173",
    actionTimeout: 30_000,
    trace: "retain-on-failure",
    ...devices["Pixel 7"],
  },
  webServer: {
    command: "bun e2e/preview-server.ts",
    url: "http://localhost:4173",
    timeout: 300_000,
    reuseExistingServer: false,
    env: {
      CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: e2eDatabaseUrl,
    },
  },
});
