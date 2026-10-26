import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

type StyleSheetFunction = ESTree.ArrowFunctionExpression | ESTree.Function;

function isStyleSheetCreate(node: ESTree.CallExpression): boolean {
  const { callee } = node;
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.object.type === "Identifier" &&
    callee.object.name === "StyleSheet" &&
    callee.property.type === "Identifier" &&
    callee.property.name === "create"
  );
}

function styleSheetFunction(node: ESTree.CallExpression): StyleSheetFunction | null {
  const [argument] = node.arguments;
  if (argument === undefined) return null;
  if (argument.type === "ArrowFunctionExpression" || argument.type === "FunctionExpression") {
    return argument;
  }
  return null;
}

/**
 * The Unistyles Babel plugin finds the theme and runtime dependencies of a style only in the style
 * itself, inside the object that the `StyleSheet.create` function returns. In a block body, a
 * local copy of a theme or runtime value hides its dependency, and the plugin takes the first
 * object that any `return` gives, also a `return` in a helper. Any other body, such as a helper
 * call, gives the plugin no styles. In each case, the styles do not update when the theme, the
 * color scheme, or the font scale changes, so the function must return its styles object directly.
 */
export const noStylesheetDependencyAliasesRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a Unistyles StyleSheet.create function to return its styles object directly, so no local or helper hides a theme or runtime dependency.",
    },
    messages: {
      indirectStyles:
        "Return the styles object directly: `StyleSheet.create((theme, rt) => ({ ... }))`. Unistyles finds style dependencies only inside each style of that object, so locals, helpers, and other returns hide them, and the styles do not update when the theme or font scale changes.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (!isStyleSheetCreate(node)) return;
        const factory = styleSheetFunction(node);
        if (factory === null || factory.body?.type === "ObjectExpression") return;
        context.report({ node: factory, messageId: "indirectStyles" });
      },
    };
  },
});
