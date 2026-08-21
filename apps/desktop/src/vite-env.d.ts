/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin. Baked at build time; the desktop app has no host page to infer one from. */
  readonly VITE_API_BASE?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
