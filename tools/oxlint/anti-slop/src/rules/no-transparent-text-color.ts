import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

// The keys that set the color of text or of an icon glyph.
const TEXT_COLOR_KEYS = new Set(["color", "colorValue"]);
// The color values that React Native turns into the number 0.
const ZERO_COLOR = /^(?:transparent|#0000|#00000000|rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\))$/i;

const zeroColor = (node: ESTree.Node | null): string | null => {
  if (node?.type === "JSXExpressionContainer") return zeroColor(node.expression);
  if (node?.type !== "Literal" || typeof node.value !== "string") return null;
  return ZERO_COLOR.test(node.value) ? node.value : null;
};

const isTextColorKey = (node: ESTree.Node): boolean => {
  if (node.type === "Identifier" || node.type === "JSXIdentifier")
    return TEXT_COLOR_KEYS.has(node.name);
  return node.type === "Literal" && typeof node.value === "string" && TEXT_COLOR_KEYS.has(node.value);
};

/**
 * React Native on Android reads the color value 0, which `transparent` is, as no color. Text and
 * icon glyphs then draw in the default color, so a field meant to hide its text shows it. A clear
 * color that is not 0, such as `rgba(255, 255, 255, 0)`, hides the glyphs.
 */
export const noTransparentTextColorRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a text or icon color whose value is 0, such as `transparent`; use `rgba(255, 255, 255, 0)`.",
    },
    messages: {
      zeroTextColor:
        "Replace `{{value}}` with a clear color that is not 0, such as `rgba(255, 255, 255, 0)`. React Native on Android reads the color value 0 as no color and draws the text in the default color.",
    },
  },
  createOnce(context) {
    const check = (node: ESTree.Node, key: ESTree.Node, value: ESTree.Node | null) => {
      const zero = zeroColor(value);
      if (zero === null || !isTextColorKey(key)) return;
      context.report({ node, messageId: "zeroTextColor", data: { value: zero } });
    };
    return {
      Property(node) {
        if (!node.computed) check(node, node.key, node.value);
      },
      JSXAttribute(node) {
        check(node, node.name, node.value);
      },
    };
  },
});
