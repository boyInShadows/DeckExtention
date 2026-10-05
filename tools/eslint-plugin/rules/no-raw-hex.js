/**
 * Deck rule: no raw hex colours outside `tokens.css`.
 *
 * AGENTS.md section 6: every colour is a design token. TypeScript, TSX and
 * config sources must never carry a literal `#rgb` / `#rrggbb` / `#rrggbbaa`
 * colour; they reference a CSS custom property instead. `tokens.css` is the
 * single file allowed to define raw hex, and it is checked by stylelint.
 */

const HEX_COLOUR = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow raw hex colour literals outside tokens.css.',
    },
    schema: [],
    messages: {
      rawHex:
        'Raw hex colour "{{value}}" is not allowed here. Define it in tokens.css and reference the CSS custom property instead.',
    },
  },
  create(context) {
    const report = (node, value) => {
      if (typeof value !== 'string') return;
      const match = HEX_COLOUR.exec(value);
      if (!match) return;
      context.report({ node, messageId: 'rawHex', data: { value: match[0] } });
    };

    return {
      Literal(node) {
        report(node, node.value);
      },
      TemplateElement(node) {
        report(node, node.value.raw);
      },
    };
  },
};

export default rule;
