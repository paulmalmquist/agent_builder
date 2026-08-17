/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AIM_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
