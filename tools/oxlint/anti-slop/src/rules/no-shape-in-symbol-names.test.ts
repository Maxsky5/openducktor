import { RuleTester } from "oxlint/plugins-dev";

import { noForbiddenTermInSymbolNamesRule } from "./no-shape-in-symbol-names.ts";

const tester = new RuleTester({
  languageOptions: {
    parserOptions: {
      lang: "tsx",
    },
  },
});
const error = { messageId: "forbiddenSymbolName" };

tester.run("anti-slop/no-shape-in-symbol-names", noForbiddenTermInSymbolNamesRule, {
  valid: [
    "const parser = input;",
    "function normalizePayload() { return value; }",
    "const panel = <Panel />;",
  ],
  invalid: [
    { code: "const responseShape = input;", errors: [error] },
    { code: "function loadShape() { return value; }", errors: [error] },
    { code: "class Example { #shapeCache = new Map(); }", errors: [error] },
    { code: "const view = <ShapePanel />;", errors: [error] },
  ],
});
