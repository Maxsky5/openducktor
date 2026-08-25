import { defineRule } from "@oxlint/plugins";

import type { ESTree, SourceCode } from "@oxlint/plugins";
import { isCallableMemberReference } from "../shared/callable-member.ts";
import { isGlobalObjectReference, resolveVariable } from "../shared/global-reference.ts";

const moduleMockMethods = new Set(["doMock", "mock", "module", "unstable_mockModule"]);

function importedName(node: ESTree.Node): string | null {
  if (node.type !== "ImportSpecifier") return null;
  return node.imported.type === "Identifier" ? node.imported.name : node.imported.value;
}

function hasFrameworkImport(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
  sourceName: string,
  importedBinding: string,
): boolean {
  const variable = resolveVariable(sourceCode, identifier);
  if (variable === null || variable.defs.length === 0) return false;
  return variable.defs.some((definition) => {
    if (definition.type !== "ImportBinding" || definition.parent?.type !== "ImportDeclaration") {
      return false;
    }
    return (
      definition.parent.source.value === sourceName &&
      importedName(definition.node) === importedBinding
    );
  });
}

function isBunMockObject(sourceCode: SourceCode, expression: ESTree.Expression): boolean {
  if (expression.type === "Identifier") {
    return hasFrameworkImport(sourceCode, expression, "bun:test", "mock");
  }
  if (
    expression.type !== "MemberExpression" ||
    expression.computed ||
    expression.object.type !== "Identifier" ||
    expression.property.type !== "Identifier" ||
    expression.property.name !== "mock"
  ) {
    return false;
  }
  const variable = resolveVariable(sourceCode, expression.object);
  if (variable === null || variable.defs.length === 0) return false;
  return variable.defs.some(
    (definition) =>
      definition.type === "ImportBinding" &&
      definition.node.type === "ImportNamespaceSpecifier" &&
      definition.parent?.type === "ImportDeclaration" &&
      definition.parent.source.value === "bun:test",
  );
}

function isTestFrameworkObject(sourceCode: SourceCode, expression: ESTree.Expression): boolean {
  if (isBunMockObject(sourceCode, expression)) return true;
  if (
    isGlobalObjectReference(sourceCode, expression, "vi") ||
    isGlobalObjectReference(sourceCode, expression, "jest")
  ) {
    return true;
  }
  if (expression.type !== "Identifier") return false;

  const variable = resolveVariable(sourceCode, expression);
  if (variable === null || variable.defs.length === 0) {
    return expression.name === "vi" || expression.name === "jest";
  }
  return (
    hasFrameworkImport(sourceCode, expression, "vitest", "vi") ||
    hasFrameworkImport(sourceCode, expression, "@jest/globals", "jest")
  );
}

function moduleMockCall(sourceCode: SourceCode, callee: ESTree.Expression): boolean {
  return isCallableMemberReference(
    sourceCode,
    callee,
    (object, propertyName) =>
      moduleMockMethods.has(propertyName) && isTestFrameworkObject(sourceCode, object),
  );
}

/** Ban test framework module mocking in favor of real dependency seams. */
export const noModuleMockingRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Bun, Vitest, and Jest module mocking; tests must replace dependencies through real interfaces.",
    },
    messages: {
      moduleMock:
        "Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === "Super" || node.callee.type === "V8IntrinsicExpression") return;
        if (moduleMockCall(context.sourceCode, node.callee)) {
          context.report({ node, messageId: "moduleMock" });
        }
      },
    };
  },
});
