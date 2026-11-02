import { defineRule } from "@oxlint/plugins";

import type { ESTree, Scope, SourceCode } from "@oxlint/plugins";

const testModules = new Set([
  "assert",
  "assert/strict",
  "bun:test",
  "node:assert",
  "node:assert/strict",
]);
const scriptsFolderPattern = /(?:^|\/)scripts\//u;
const testFilePattern = /\.test\.ts$/u;

const isTestModule = (source: ESTree.Node): boolean =>
  source.type === "Literal" && typeof source.value === "string" && testModules.has(source.value);

/** Reports whether a name has no declaration, so it resolves to the runtime environment. */
const isImplicitGlobal = (
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
): boolean => {
  let scope: Scope | null = sourceCode.getScope(identifier);
  while (scope !== null) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined) return variable.defs.length === 0;
    scope = scope.upper;
  }
  return true;
};

/** Ban test modules in scripts so checks of production behavior live in the test suite. */
export const noTestImportsInScriptsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow test modules in scripts folders; test logic must live in *.test.ts files.",
    },
    messages: {
      testImport:
        "Move test logic from 'scripts' into a test file, such as a '*.test.ts' file next to the code under test.",
    },
  },
  create(context) {
    const filePath = context.filename.replaceAll("\\", "/");
    if (!scriptsFolderPattern.test(filePath) || testFilePattern.test(filePath)) return {};

    const report = (node: ESTree.Node): void => {
      context.report({ node, messageId: "testImport" });
    };

    return {
      ImportDeclaration(node) {
        if (isTestModule(node.source)) report(node);
      },
      ImportExpression(node) {
        if (isTestModule(node.source)) report(node);
      },
      ExportNamedDeclaration(node) {
        if (node.source !== null && isTestModule(node.source)) report(node);
      },
      ExportAllDeclaration(node) {
        if (isTestModule(node.source)) report(node);
      },
      CallExpression(node) {
        const [source] = node.arguments;
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "require" &&
          isImplicitGlobal(context.sourceCode, node.callee) &&
          node.arguments.length === 1 &&
          source !== undefined &&
          isTestModule(source)
        ) {
          report(node);
        }
      },
    };
  },
});
