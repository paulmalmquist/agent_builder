import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));
  const workspaceEnvironment = loadEnv(mode, workspaceRoot, '');
  const repositorySourceCommit =
    process.env['REPOSITORY_SOURCE_COMMIT'] ??
    workspaceEnvironment['REPOSITORY_SOURCE_COMMIT'] ??
    '';

  return {
    define: {
      'import.meta.env.VITE_PAUL_OS_BUILD_COMMIT': JSON.stringify(repositorySourceCommit),
    },
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/v1': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/agents': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/health': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/live': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/ready': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/openapi.json': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    preview: {
      port: 4173,
    },
    test: {
      environment: 'jsdom',
      environmentOptions: {
        jsdom: {
          url: 'http://localhost/',
        },
      },
      globals: true,
      testTimeout: 15_000,
      setupFiles: ['./src/test/setup.ts'],
      css: true,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html'],
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/test/**', 'src/main.tsx'],
      },
    },
  };
});
