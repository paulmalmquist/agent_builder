/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AIM_ENABLED?: string;
  readonly VITE_PAUL_OS_BUILD_COMMIT?: string;
  readonly VITE_VISUAL_SURFACES_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
