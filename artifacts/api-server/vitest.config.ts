import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@workspace/api-server": path.resolve(__dirname, "./src"),
      "@workspace/db": path.resolve(__dirname, "../../lib/db/src"),
      "@workspace/db/schema": path.resolve(__dirname, "../../lib/db/src/schema"),
      "@workspace/api-zod": path.resolve(__dirname, "../../lib/api-zod"),
    },
  },
  test: {
    setupFiles: ["./vitest.setup.ts"],
    include: ["test/**/*.test.ts"],
    testTimeout: 10000,
  },
});