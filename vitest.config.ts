import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node environment — tests call real HTTP endpoints
    environment: "node",

    // Individual test timeout (bootstrap overrides its own via beforeAll)
    testTimeout: 15_000,

    // Run test files sequentially so the shared bootstrap cache is never raced
    fileParallelism: false,

    // Only pick up files in tests/
    include: ["tests/**/*.test.ts"],
  },
});
