import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  auth: false,
  branch: (branch) => {
    if (branch.isDefault || branch.name === "dev") {
      return {};
    }

    if (!branch.exists) {
      return { ttl: "7d" };
    }

    return {};
  },
});
