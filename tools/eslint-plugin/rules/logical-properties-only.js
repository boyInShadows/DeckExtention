/**
 * Deck rule: CSS logical properties only.
 *
 * AGENTS.md section 6 / section 2: the UI is English for P1-P2 but Persian is a
 * translation file later, never a rewrite. That only holds if nothing in the
 * codebase hardcodes a writing direction. This rule covers the JavaScript side:
 * React inline `style` objects and Tailwind utility classes. The CSS side is
 * covered by stylelint's `property-disallowed-list`.
 */

/**
 * Physical camelCase properties in a React style object -> logical replacement.
 *
 * `width`/`height` are deliberately absent: Deck only ever uses horizontal-tb
 * writing modes, so those two are not a direction hazard, and flagging them
 * would be dogma rather than a guardrail.
 */
const PHYSICAL_STYLE_PROPERTIES = new Map([
  ['marginLeft', 'marginInlineStart'],
  ['marginRight', 'marginInlineEnd'],
  ['marginTop', 'marginBlockStart'],
  ['marginBottom', 'marginBlockEnd'],
  ['paddingLeft', 'paddingInlineStart'],
  ['paddingRight', 'paddingInlineEnd'],
  ['paddingTop', 'paddingBlockStart'],
  ['paddingBottom', 'paddingBlockEnd'],
  ['borderLeft', 'borderInlineStart'],
  ['borderRight', 'borderInlineEnd'],
  ['borderTop', 'borderBlockStart'],
  ['borderBottom', 'borderBlockEnd'],
  ['borderLeftWidth', 'borderInlineStartWidth'],
  ['borderRightWidth', 'borderInlineEndWidth'],
  ['borderLeftColor', 'borderInlineStartColor'],
  ['borderRightColor', 'borderInlineEndColor'],
  ['left', 'insetInlineStart'],
  ['right', 'insetInlineEnd'],
  ['top', 'insetBlockStart'],
  ['bottom', 'insetBlockEnd'],
  ['borderTopLeftRadius', 'borderStartStartRadius'],
  ['borderTopRightRadius', 'borderStartEndRadius'],
  ['borderBottomLeftRadius', 'borderEndStartRadius'],
  ['borderBottomRightRadius', 'borderEndEndRadius'],
]);

/**
 * Direction-bound Tailwind utilities -> logical replacement.
 * Each entry is [matcher, suggestion]. A matcher is tested against one class.
 */
const PHYSICAL_CLASS_RULES = [
  [/^-?ml-/, 'ms-*'],
  [/^-?mr-/, 'me-*'],
  [/^pl-/, 'ps-*'],
  [/^pr-/, 'pe-*'],
  [/^-?left-/, 'start-*'],
  [/^-?right-/, 'end-*'],
  [/^border-l(?:$|-)/, 'border-s*'],
  [/^border-r(?:$|-)/, 'border-e*'],
  [/^rounded-l(?:$|-)/, 'rounded-s*'],
  [/^rounded-r(?:$|-)/, 'rounded-e*'],
  [/^rounded-tl(?:$|-)/, 'rounded-ss*'],
  [/^rounded-tr(?:$|-)/, 'rounded-se*'],
  [/^rounded-bl(?:$|-)/, 'rounded-es*'],
  [/^rounded-br(?:$|-)/, 'rounded-ee*'],
  [/^text-left$/, 'text-start'],
  [/^text-right$/, 'text-end'],
  [/^float-left$/, 'float-start'],
  [/^float-right$/, 'float-end'],
  [/^clear-left$/, 'clear-start'],
  [/^clear-right$/, 'clear-end'],
];

/** Strip Tailwind variant prefixes (`hover:`, `md:`, `dark:`) from a class. */
const baseClass = (className) => {
  const parts = className.split(':');
  return parts[parts.length - 1];
};

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require CSS logical properties instead of direction-bound physical ones.',
    },
    schema: [],
    messages: {
      physicalStyle:
        'Physical CSS property "{{name}}" breaks RTL. Use "{{logical}}" instead.',
      physicalClass:
        'Direction-bound utility class "{{name}}" breaks RTL. Use "{{logical}}" instead.',
    },
  },
  create(context) {
    const checkClassString = (node, value) => {
      if (typeof value !== 'string') return;
      for (const raw of value.split(/\s+/)) {
        if (!raw) continue;
        const name = baseClass(raw);
        for (const [matcher, logical] of PHYSICAL_CLASS_RULES) {
          if (!matcher.test(name)) continue;
          context.report({
            node,
            messageId: 'physicalClass',
            data: { name: raw, logical },
          });
          break;
        }
      }
    };

    const isStyleObject = (node) => {
      const parent = node.parent;
      if (!parent) return false;
      if (parent.type === 'JSXExpressionContainer') {
        const attribute = parent.parent;
        return (
          attribute?.type === 'JSXAttribute' && attribute.name?.name === 'style'
        );
      }
      return false;
    };

    return {
      ObjectExpression(node) {
        if (!isStyleObject(node)) return;
        for (const property of node.properties) {
          if (property.type !== 'Property') continue;
          const key = property.key;
          const name =
            key.type === 'Identifier'
              ? key.name
              : key.type === 'Literal'
                ? key.value
                : undefined;
          const logical = PHYSICAL_STYLE_PROPERTIES.get(name);
          if (!logical) continue;
          context.report({
            node: property,
            messageId: 'physicalStyle',
            data: { name, logical },
          });
        }
      },
      JSXAttribute(node) {
        if (node.name?.name !== 'className') return;
        const value = node.value;
        if (!value) return;
        if (value.type === 'Literal') {
          checkClassString(value, value.value);
          return;
        }
        if (
          value.type === 'JSXExpressionContainer' &&
          value.expression.type === 'Literal'
        ) {
          checkClassString(value.expression, value.expression.value);
        }
      },
    };
  },
};

export default rule;
