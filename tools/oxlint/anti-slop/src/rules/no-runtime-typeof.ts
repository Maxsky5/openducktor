import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

type NoRuntimeTypeofOption = {
  allowInTypeGuards?: boolean;
};

const equalityOperators = new Set(["===", "!==", "==", "!="]);
const runtimeTypeNames = new Set([
  "bigint",
  "boolean",
  "function",
  "number",
  "object",
  "string",
  "symbol",
  "undefined",
]);

function isRuntimeTypeName(node: ESTree.Expression): boolean {
  return (
    node.type === "Literal" && typeof node.value === "string" && runtimeTypeNames.has(node.value)
  );
}

function isNarrowingComparison(node: ESTree.UnaryExpression): boolean {
  const parent = node.parent;
  if (parent.type !== "BinaryExpression" || !equalityOperators.has(parent.operator)) return false;
  if (parent.left === node) return isRuntimeTypeName(parent.right);
  return (
    parent.right === node &&
    parent.left.type !== "PrivateIdentifier" &&
    isRuntimeTypeName(parent.left)
  );
}

/** Disallow runtime type-name inspection while preserving idiomatic TypeScript narrowing. */
export const noRuntimeTypeofRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow runtime type-name inspection; direct primitive comparisons remain valid TypeScript narrowing.",
    },
    messages: {
      runtimeTypeof:
        "Do not use `typeof` as runtime type metadata. Compare it directly with a primitive type name for narrowing, or parse external input at its I/O boundary.",
    },
    schema: [
      {
        type: "object",
        properties: {
          allowInTypeGuards: { type: "boolean" },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ allowInTypeGuards: false }],
  },
  createOnce(context) {
    return {
      UnaryExpression(node) {
        // SAFETY: The rule metadata schema validates this exact option before rule execution.
        const option = context.options?.[0] as NoRuntimeTypeofOption | undefined;
        const allowInTypeGuards = option?.allowInTypeGuards === true;
        if (node.operator === "typeof" && (!allowInTypeGuards || !isNarrowingComparison(node))) {
          context.report({ node, messageId: "runtimeTypeof" });
        }
      },
    };
  },
});
