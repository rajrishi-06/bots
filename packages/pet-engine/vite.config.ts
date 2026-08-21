import { defineConfig } from "vite";

export default defineConfig({
  root: "demo",
  // Relative base so the built gallery also opens straight from the filesystem.
  base: "./",
  build: { outDir: "../demo-dist", emptyOutDir: true },
  server: { port: 5174 },
});
