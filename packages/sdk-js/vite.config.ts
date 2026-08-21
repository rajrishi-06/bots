import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: { entry: "src/loader.ts", formats: ["es"], fileName: () => "loader.js" },
    target: "es2020",
    minify: "esbuild",
  },
});
