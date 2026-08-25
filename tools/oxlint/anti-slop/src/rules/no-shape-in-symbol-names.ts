import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

import { resolveVariable } from "../shared/global-reference.ts";

const FORBIDDEN_SYMBOL_NAME = "shape";

function containsForbiddenSymbolName(name: string): boolean {
  return name.toLowerCase().includes(FORBIDDEN_SYMBOL_NAME);
}

function isDeclaredBinding(
  sourceCode: Parameters<typeof resolveVariable>[0],
  node: ESTree.BindingIdentifier | ESTree.IdentifierReference,
): boolean {
  const variable = resolveVariable(sourceCode, node);
  return (
    variable?.identifiers.some(
      (identifier) => identifier.start === node.start && identifier.end === node.end,
    ) === true
  );
}

function isDeclaredMemberName(node: ESTree.Node & { name: string }): boolean {
  const parent = node.parent;
  if (parent === null) return false;
  switch (parent.type) {
    case "Property":
      return parent.parent.type === "ObjectExpression" && parent.key === node && !parent.computed;
    case "AccessorProperty":
    case "MethodDefinition":
    case "PropertyDefinition":
    case "TSMethodSignature":
    case "TSPropertySignature":
      return parent.key === node && !parent.computed;
    default:
      return false;
  }
}

/** Ban the case-insensitive substring "shape" in repository-owned symbol declarations. */
export const noForbiddenTermInSymbolNamesRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        'Disallow the case-insensitive substring "shape" in repository-owned bindings and member declarations.',
    },
    messages: {
      forbiddenSymbolName:
        'Rename symbol "{{name}}" for its domain role; "shape" describes structure rather than ownership.',
    },
  },
  createOnce(context) {
    const reportForbiddenSymbolName = (node: ESTree.Node & { name: string }) => {
      if (!containsForbiddenSymbolName(node.name)) return;
      context.report({
        node,
        messageId: "forbiddenSymbolName",
        data: { name: node.name },
      });
    };

    return {
      Identifier(node) {
        if (isDeclaredBinding(context.sourceCode, node) || isDeclaredMemberName(node)) {
          reportForbiddenSymbolName(node);
        }
      },
      PrivateIdentifier(node) {
        if (isDeclaredMemberName(node)) reportForbiddenSymbolName(node);
      },
    };
  },
});
