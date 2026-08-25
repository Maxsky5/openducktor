import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

import { resolveVariable } from "../shared/global-reference.ts";

const FORBIDDEN_SYMBOL_NAME = "shape";
export const noForbiddenTermInSymbolNamesRuleId = "no-shape-in-symbol-names";

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

function isDeclaredMemberName(node: ESTree.Node): boolean {
  const parent = node.parent;
  if (parent === null) return false;
  switch (parent.type) {
    case "Property":
      return parent.parent.type === "ObjectExpression" && parent.key === node;
    case "AccessorProperty":
    case "MethodDefinition":
    case "PropertyDefinition":
    case "TSMethodSignature":
    case "TSPropertySignature":
      return parent.key === node;
    case "TSEnumMember":
      return parent.id === node;
    default:
      return false;
  }
}

function declaredMemberName(node: ESTree.Node): string | null {
  if (!isDeclaredMemberName(node)) return null;
  if (node.type === "Identifier" || node.type === "PrivateIdentifier") {
    return "computed" in node.parent && node.parent.computed ? null : node.name;
  }
  return node.type === "Literal" && typeof node.value === "string" ? node.value : null;
}

function exportedSymbolName(node: ESTree.ExportSpecifier["exported"]): string | null {
  if (node.type === "Identifier") return node.name;
  return typeof node.value === "string" ? node.value : null;
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
    const reportForbiddenSymbolName = (node: ESTree.Node, name: string) => {
      if (!containsForbiddenSymbolName(name)) return;
      context.report({
        node,
        messageId: "forbiddenSymbolName",
        data: { name },
      });
    };

    return {
      ExportSpecifier(node) {
        const name = exportedSymbolName(node.exported);
        if (name !== null) reportForbiddenSymbolName(node.exported, name);
      },
      Identifier(node) {
        if (isDeclaredBinding(context.sourceCode, node)) {
          reportForbiddenSymbolName(node, node.name);
          return;
        }
        const name = declaredMemberName(node);
        if (name !== null) reportForbiddenSymbolName(node, name);
      },
      Literal(node) {
        const name = declaredMemberName(node);
        if (name !== null) reportForbiddenSymbolName(node, name);
      },
      PrivateIdentifier(node) {
        const name = declaredMemberName(node);
        if (name !== null) reportForbiddenSymbolName(node, name);
      },
    };
  },
});
