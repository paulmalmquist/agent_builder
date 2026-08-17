import eslint from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/generated/**',
      '.local/**',
      '.runtime/**',
      '**/*.config.cjs',
      'eslint.config.js',
      'apps/backend/prisma/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'scripts/*.mjs',
            'apps/backend/tests/*.smoke.mjs',
            'apps/workstation-broker/scripts/*.mjs',
            'packages/contracts/test/*.mjs',
            'packages/runtime/test/*.mjs',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  {
    files: ['apps/frontend/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: [
      'apps/backend/**/*.ts',
      'apps/generator-cli/**/*.ts',
      'apps/worker/**/*.ts',
      'e2e/**/*.ts',
      'packages/contracts/**/*.ts',
      'packages/runtime/**/*.ts',
      'scripts/**/*.mjs',
      'apps/workstation-broker/scripts/**/*.mjs',
      'apps/backend/tests/**/*.smoke.mjs',
      'packages/contracts/test/**/*.mjs',
      'packages/runtime/test/**/*.mjs',
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/*.{test,spec}.{ts,tsx}', '**/test/**/*.ts', '**/tests/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
  {
    files: [
      'scripts/**/*.mjs',
      'apps/workstation-broker/scripts/**/*.mjs',
      'apps/backend/tests/**/*.smoke.mjs',
      'packages/contracts/test/**/*.mjs',
      'packages/runtime/test/**/*.mjs',
    ],
    ...tseslint.configs.disableTypeChecked,
  },
);
