import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["surfpool/**/*.test.ts"],
  },
});
