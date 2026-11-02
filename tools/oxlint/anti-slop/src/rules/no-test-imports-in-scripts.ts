import { defineRule } from "@oxlint/plugins";

const testModules = new Set(["assert", "bun:test", "node:assert", "node:assert/strict"]);
const scriptsFolderPattern = /(?:^|\/)scripts\//u;
const testFilePattern = /\.test\.[cm]?[jt]sx?$/u;

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

    return {
      ImportDeclaration(node) {
        if (typeof node.source.value === "string" && testModules.has(node.source.value)) {
          context.report({ node, messageId: "testImport" });
        }
      },
    };
  },
});
