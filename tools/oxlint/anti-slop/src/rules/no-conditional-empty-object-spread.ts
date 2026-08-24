import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

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

function isConditionalEmptyObjectSpread(node: ESTree.Expression): boolean {
  const conditional = unwrapParentheses(node);
  return (
    conditional.type === "ConditionalExpression" &&
    (isEmptyObjectExpression(conditional.consequent) ||
      isEmptyObjectExpression(conditional.alternate))
  );
}

function isEmptyObjectReturn(node: ESTree.Statement): boolean {
  if (node.type === "ReturnStatement") {
    return node.argument !== null && isEmptyObjectExpression(unwrapParentheses(node.argument));
  }
  if (node.type === "BlockStatement") {
    return node.body.some(isEmptyObjectReturn);
  }
  if (node.type === "IfStatement") {
    return (
      isEmptyObjectReturn(node.consequent) ||
      (node.alternate !== null && isEmptyObjectReturn(node.alternate))
    );
  }
  return false;
}

function isEmptyObjectSpreadIife(node: ESTree.Expression): boolean {
  const call = unwrapParentheses(node);
  if (call.type !== "CallExpression" || call.arguments.length !== 0) return false;
  const callee = unwrapParentheses(call.callee);
  return (
    callee.type === "ArrowFunctionExpression" &&
    callee.body.type === "BlockStatement" &&
    callee.body.body.some(isEmptyObjectReturn)
  );
}

/** Ban conditional empty-object spreads without changing their omission semantics. */
export const noConditionalEmptyObjectSpreadRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow object spreads that conditionally spread an empty object to omit fields.",
    },
    messages: {
      avoid:
        "This spread hides property omission behind an empty object. Spread `undefined` for the omitted branch or build the object before the return.",
    },
  },
  createOnce(context) {
    return {
      SpreadElement(node) {
        if (node.parent.type !== "ObjectExpression") return;

        if (
          isConditionalEmptyObjectSpread(node.argument) ||
          isEmptyObjectSpreadIife(node.argument)
        ) {
          context.report({ node, messageId: "avoid" });
        }
      },
    };
  },
});
