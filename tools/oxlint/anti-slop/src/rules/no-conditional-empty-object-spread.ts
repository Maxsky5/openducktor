import { defineRule } from "@oxlint/plugins";
import type { ESTree, Scope, SourceCode } from "@oxlint/plugins";

function unwrapParentheses(node: ESTree.Expression): ESTree.Expression {
  let current = node;
  while (current.type === "ParenthesizedExpression") {
    current = current.expression;
  }
  return current;
}

function isEmptyObjectExpression(node: ESTree.Expression): boolean {
  return node.type === "ObjectExpression" && node.properties.length === 0;
}

function isGlobalUndefined(sourceCode: SourceCode, node: ESTree.Expression): boolean {
  if (node.type !== "Identifier" || node.name !== "undefined") return false;
  if (sourceCode.isGlobalReference(node)) return true;

  let scope: Scope | null = sourceCode.getScope(node);
  while (scope !== null) {
    const variable = scope.set.get(node.name);
    if (variable !== undefined) return variable.defs.length === 0;
    scope = scope.upper;
  }
  return true;
}

function isOmissionExpression(sourceCode: SourceCode, node: ESTree.Expression): boolean {
  const expression = unwrapParentheses(node);
  return isEmptyObjectExpression(expression) || isGlobalUndefined(sourceCode, expression);
}

function isConditionalOmissionSpread(sourceCode: SourceCode, node: ESTree.Expression): boolean {
  const conditional = unwrapParentheses(node);
  return (
    conditional.type === "ConditionalExpression" &&
    (isOmissionExpression(sourceCode, conditional.consequent) ||
      isOmissionExpression(sourceCode, conditional.alternate))
  );
}

/** Ban conditional no-op object spreads without changing their omission semantics. */
export const noConditionalEmptyObjectSpreadRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow object spreads that conditionally spread an empty object or undefined to omit fields.",
    },
    messages: {
      avoid:
        "This conditional spread hides property omission behind an empty object or undefined. Build the object in separate statements and add the property only when present.",
    },
  },
  createOnce(context) {
    return {
      SpreadElement(node) {
        if (node.parent.type !== "ObjectExpression") return;

        if (isConditionalOmissionSpread(context.sourceCode, node.argument)) {
          context.report({ node, messageId: "avoid" });
        }
      },
    };
  },
});
