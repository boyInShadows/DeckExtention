import js from '@eslint/js';
import deck from 'deck-eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Flat config for the whole workspace.
 *
 * `deck/no-raw-hex` and `deck/logical-properties-only` are the two guardrails
 * from AGENTS.md section 6 that no published plugin covers. Their CSS-side
 * counterparts live in stylelint.config.js, because CSS is stylelint's job.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.vite/**',
      'apps/extension/public/**',
    ],
  },

  js.configs.recommended,
  tseslint.configs.strict,

  {
    plugins: { deck },
    rules: {
      'deck/no-raw-hex': 'error',
      'deck/logical-properties-only': 'error',
      'no-console': 'error',
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message:
            'AGENTS.md 3.2: Deck makes no network requests. Fonts, icons and favicons are local.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'NewExpression[callee.name=/^(XMLHttpRequest|WebSocket|EventSource)$/]',
          message:
            'AGENTS.md 3.2: Deck makes no network requests. Fonts, icons and favicons are local.',
        },
        {
          selector: "CallExpression[callee.property.name='sendBeacon']",
          message: 'AGENTS.md 3.2: no telemetry, no network.',
        },
      ],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  {
    files: ['apps/extension/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, chrome: 'readonly' },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },

  {
    files: [
      'eslint.config.js',
      'stylelint.config.js',
      'tools/**/*.js',
      'tools/**/*.mjs',
      'apps/*/vite.config.ts',
      'apps/*/manifest.config.ts',
    ],
    languageOptions: { globals: globals.node },
  },

  {
    /* Fixtures are data, not code: they exist to be wrong. */
    files: ['**/test/fixtures/**'],
    rules: { 'deck/no-raw-hex': 'off' },
  },
);
