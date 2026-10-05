/**
 * CSS-side guardrails (AGENTS.md section 6).
 *
 *   colours     raw hex is legal in tokens.css and nowhere else
 *   direction   physical properties are banned outright; use logical ones
 *
 * ESLint covers the same two rules on the TypeScript side; CSS is stylelint's
 * job because a CSS parser is what you need to do it without false positives.
 */

/** Direction-bound declarations that break RTL. */
const PHYSICAL_PROPERTIES = [
  'margin-left',
  'margin-right',
  'margin-top',
  'margin-bottom',
  'padding-left',
  'padding-right',
  'padding-top',
  'padding-bottom',
  'border-left',
  'border-right',
  'border-top',
  'border-bottom',
  'border-left-width',
  'border-right-width',
  'border-left-color',
  'border-right-color',
  'border-left-style',
  'border-right-style',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'left',
  'right',
];

/** Tailwind 4 is configured in CSS, so its at-rules are expected. */
const TAILWIND_AT_RULES = [
  'theme',
  'source',
  'utility',
  'variant',
  'custom-variant',
  'apply',
  'reference',
  'config',
  'plugin',
  'layer',
];

export default {
  extends: ['stylelint-config-standard'],
  ignoreFiles: ['**/dist/**', '**/node_modules/**'],
  rules: {
    'color-no-hex': true,

    /* Six digits everywhere, so tokens.css reads as one column of colours. */
    'color-hex-length': 'long',

    /*
     * Tokens are grouped by role with a blank line and a heading comment. That
     * grouping is the point of the file, so the blank lines stay.
     */
    'custom-property-empty-line-before': null,
    'property-disallowed-list': PHYSICAL_PROPERTIES,
    'declaration-property-value-disallowed-list': {
      'text-align': ['/^left$/', '/^right$/'],
      float: ['/^left$/', '/^right$/'],
      clear: ['/^left$/', '/^right$/'],
    },
    'at-rule-no-unknown': [true, { ignoreAtRules: TAILWIND_AT_RULES }],
    'import-notation': 'string',
    'custom-property-pattern': null,
    'selector-class-pattern': null,
  },
  overrides: [
    {
      /* The one file allowed to hold a raw colour. */
      files: ['**/tokens.css'],
      rules: { 'color-no-hex': null },
    },
  ],
};
