/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AIM_ENABLED?: string;
  readonly VITE_VISUAL_SURFACES_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
