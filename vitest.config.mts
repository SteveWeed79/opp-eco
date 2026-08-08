import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Vitest does not read tsconfig paths, so without this alias every module
 * using `@/*` is unimportable from a test — which silently left the data,
 * session, and query layers untestable.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
