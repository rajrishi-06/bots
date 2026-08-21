import { defineConfig } from "vite";

export default defineConfig({
  root: "src",
  build: { outDir: "../dist", emptyOutDir: true },
  // Tauri serves this over a custom protocol, so every asset path must be relative.
  base: "./",
  server: { port: 5175, strictPort: true },
});
