import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier/flat';

const tsFiles = ['**/*.{ts,tsx,mts,cts}'];
const browserFiles = ['src/**/*.{js,jsx,mjs,ts,tsx}', 'apps/*/src/**/*.{js,jsx,mjs,ts,tsx}', 'test-support/browser/**/*.{js,jsx,mjs,ts,tsx}'];

export default [
  {
    ignores: [
      '**/node_modules/**', '**/dist/**', '**/build/**', '**/coverage/**',
      '.pages-dist/**', '.cache/**', '.vite/**', '**/.wrangler/**',
      'performance/**', 'public/**', 'originData/**',
      '**/*.generated.*', 'apps/*/src/data/generated/**',
    ],
  },
  {
    files: ['**/*.{js,jsx,mjs,cjs}', ...tsFiles],
    languageOptions: {
      ecmaVersion: 'latest',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: js.configs.recommended.rules,
  },
  // Keep typed rules off JS, including the Node maintenance scripts.
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({ ...config, files: tsFiles })),
  {
    files: browserFiles,
    languageOptions: { globals: globals.browser },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  {
    files: ['scripts/**/*.{js,mjs,cjs}', '**/*.config.{js,mjs,cjs,ts,mts,cts}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: tsFiles,
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          varsIgnorePattern: '^[A-Z_]',
          argsIgnorePattern: '^[A-Z_]',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/utils', '@/utils/*', '@/utils/**'],
              message: 'Import from src/lib, src/platform, or src/services instead of src/utils.',
            },
          ],
        },
      ],
      'no-unused-vars': 'off',
    },
  },
  {
    files: ['src/{component,services,lib,platform,store}/**/*.{ts,tsx}', 'apps/*/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@/utils', '@/utils/**'], message: 'Import from src/lib, src/platform, or src/services instead of src/utils.' },
          { group: ['@/pages', '@/pages/**', '@main/pages', '@main/pages/**', '**/pages/**'], message: 'Shared modules and standalone apps must not depend on main-site pages.' },
        ],
      }],
    },
  },
  ...['intel', 'user-hub'].map((app) => ({
    files: [`apps/${app}/**/*.{ts,tsx,mts,cts}`],
    languageOptions: { parserOptions: { project: [`./apps/${app}/tsconfig.json`] } },
  })),
  ...['oem-relink', 'oem-search'].map((worker) => ({
    files: [`${worker}/src/**/*.{ts,tsx}`],
    languageOptions: {
      globals: globals.worker,
      parserOptions: { project: [`./${worker}/tsconfig.json`] },
    },
  })),
  {
    files: ['**/*.{test,spec}.{js,mjs,cjs,ts,tsx}', '**/*{setup,Setup}.ts', 'test-support/**/*.ts', 'test-support/browser/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  eslintConfigPrettier,
];
