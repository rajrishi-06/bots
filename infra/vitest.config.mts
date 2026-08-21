import { defineConfig } from "vitest/config";

export default defineConfig({
  // Scoped explicitly: the default glob walked node_modules and ran the test
  // suites of every transitive dependency — 265 files, 169 of them failing.
  test: { include: ["*.test.ts", "lib/**/*.test.ts"] },
});
