import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript source rather than build output — one
  // less build step, and the dashboard is the only consumer needing them compiled.
  transpilePackages: ["@bots/core", "@bots/db", "@bots/rag", "@bots/pet-engine"],
  // typedRoutes is off: every route here is dynamic (/bots/[id]/...), so a
  // template-string href never satisfies the generated union and each one needs
  // an `as Route` cast — which is a cast asserting exactly what the feature was
  // meant to prove.

  // Those packages use ESM-style relative imports ("./spring.js") that resolve to
  // .ts on disk — correct TypeScript, and what tsx/vite/vitest already do. Webpack
  // does not do it by default, so it must be told.
  webpack: (cfg) => {
    cfg.resolve.extensionAlias = {
      ...cfg.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return cfg;
  },
  turbopack: {
    resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"],
  },
};

export default config;
