import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/{unit,integration}/**/*.test.ts"],
    maxWorkers: 4,
    testTimeout: 10_000,
    hookTimeout: 10_000,
    reporters: ["default", "json"],
    outputFile: { json: "reports/tests.json" },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Compiled child-process tests exercise executable entry points separately.
      exclude: ["src/server.ts", "src/healthcheck.ts"],
      reporter: ["text", "json-summary", "html"],
      thresholds: { statements: 90, branches: 85, functions: 90, lines: 90 },
    },
  },
});
