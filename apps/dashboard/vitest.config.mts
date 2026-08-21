import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "happy-dom", include: ["src/**/*.test.ts", "src/**/*.test.tsx"] },
  // Next applies the automatic JSX runtime through its own compiler, so the
  // tsconfig says `preserve`. vitest compiles these files itself and has to be
  // told separately.
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
});
