import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: { entry: "src/index.ts", formats: ["es"], fileName: () => "petbot.js" },
    // No externals: this is an embeddable and must be one self-contained file.
    rollupOptions: { output: { inlineDynamicImports: true } },
    target: "es2020",
    minify: "esbuild",
    reportCompressedSize: true,
  },
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
});
