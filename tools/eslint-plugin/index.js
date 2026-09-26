/**
 * Local ESLint plugin for Deck.
 *
 * Two guardrails from AGENTS.md section 6 that no off-the-shelf plugin covers:
 *   deck/no-raw-hex               - colours live in tokens.css, nowhere else
 *   deck/logical-properties-only  - nothing hardcodes a writing direction
 */
import noRawHex from './rules/no-raw-hex.js';
import logicalPropertiesOnly from './rules/logical-properties-only.js';

const plugin = {
  meta: {
    name: 'deck-eslint-plugin',
    version: '0.0.0',
  },
  rules: {
    'no-raw-hex': noRawHex,
    'logical-properties-only': logicalPropertiesOnly,
  },
};

export default plugin;
