import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Tests resolve `@/` the same way the app does.
 *
 * Without this, a test could only import by relative path, which quietly pushed
 * shared types into whichever module happened to be reachable rather than the
 * one they belong in.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
