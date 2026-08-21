import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The rig writes to real SVG elements, so the tests need a DOM. happy-dom
    // is enough: querySelector, innerHTML and setAttribute are all it touches.
    environment: "happy-dom",
  },
});
