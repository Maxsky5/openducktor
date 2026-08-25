import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";
import { unwrapTransparentExpression } from "../shared/transparent-expression.ts";

function isEmptyObjectExpression(node: ESTree.Expression): boolean {
  return node.type === "ObjectExpression" && node.properties.length === 0;
}

function isConditionalEmptyObjectSpread(node: ESTree.Expression): boolean {
  const conditional = unwrapTransparentExpression(node, { includeTypeAssertions: true });
  return (
    conditional.type === "ConditionalExpression" &&
    (isEmptyObjectExpression(conditional.consequent) ||
      isEmptyObjectExpression(conditional.alternate))
  );
}

function isEmptyObjectReturn(node: ESTree.Statement): boolean {
  if (node.type === "ReturnStatement") {
    if (node.argument === null) return false;
    const returned = unwrapTransparentExpression(node.argument, {
      includeTypeAssertions: true,
    });
    return isEmptyObjectExpression(returned) || isConditionalEmptyObjectSpread(returned);
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
  const call = unwrapTransparentExpression(node, { includeTypeAssertions: true });
  if (call.type !== "CallExpression" || call.arguments.length !== 0) return false;
  const callee = unwrapTransparentExpression(call.callee, { includeTypeAssertions: true });
  if (callee.type !== "ArrowFunctionExpression" && callee.type !== "FunctionExpression") {
    return false;
  }
  if (callee.body === null) return false;
  return callee.body.type === "BlockStatement"
    ? callee.body.body.some(isEmptyObjectReturn)
    : isConditionalEmptyObjectSpread(callee.body);
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
