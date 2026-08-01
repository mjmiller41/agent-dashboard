// @ts-check
import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'workspace/**', 'workspace.example/**'],
  },
  js.configs.recommended,
  // Not using recommendedTypeChecked: it requires every linted file (incl.
  // *.config.ts/*.config.js) to be inside a workspace tsconfig's "include",
  // which config files aren't. Real type safety is enforced separately by
  // each workspace's "typecheck" script (tsc --noEmit), run by `npm run check`.
  ...tseslint.configs.recommended,
  // Node workspaces (server, shared, root scripts)
  {
    files: ['server/**/*.ts', 'shared/**/*.ts', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  // e2e/: Playwright specs + config run under Node, not a bundler (PLAN.md
  // §2 "E2E: Playwright", §11 Phase 5).
  {
    files: ['e2e/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  // Web workspace: React + browser globals
  {
    files: ['web/**/*.{ts,tsx}'],
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
  // Config files themselves run under Node but aren't part of a workspace tsconfig "include".
  {
    files: ['*.config.{js,mjs,ts}', '**/*.config.{js,mjs,ts}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  prettierConfig,
);
