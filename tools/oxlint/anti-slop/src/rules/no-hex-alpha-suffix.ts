import { defineRule } from "@oxlint/plugins";

// Two hex digits right after a color expression, at the end or before a CSS separator.
const HEX_ALPHA = /^([0-9a-f]{2})(?:$|[\s,)])/i;
// A color starts the literal or follows a CSS separator, as in `0 0 9px ${color}38`.
const COLOR_START = /(?:^|[\s,(])$/;

/**
 * A template literal such as `${color}40`, or `0 0 9px ${color}38` in a CSS value, adds alpha to a
 * color with two hex digits. When the
 * color already has an alpha channel, the result has 10 digits, and React Native drops it with
 * only a log line. `withAlpha(color, alpha)` refuses such a color, so the failure shows at once.
 */
export const noHexAlphaSuffixRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a template literal that adds two hex alpha digits to a color; use `withAlpha(color, alpha)`.",
    },
    messages: {
      hexAlphaSuffix:
        "Replace the hex alpha suffix `{{suffix}}` with `withAlpha(color, alpha)`, where alpha goes from 0 to 1. `withAlpha` refuses a color that already has an alpha channel. A suffix makes a 10-digit color, which React Native drops with only a log line.",
    },
  },
  createOnce(context) {
    return {
      TemplateLiteral(node) {
        node.expressions.forEach((_, index) => {
          const before = node.quasis[index]?.value.raw ?? "";
          const after = node.quasis[index + 1]?.value.raw ?? "";
          // An expression right after another one builds a hex color from parts.
          if (index > 0 && before === "") return;
          const suffix = HEX_ALPHA.exec(after)?.[1];
          if (suffix === undefined || !COLOR_START.test(before)) return;
          context.report({ node, messageId: "hexAlphaSuffix", data: { suffix } });
        });
      },
    };
  },
});
