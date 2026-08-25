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
    "const fields = schema.shape;",
    "const fields = schema['shape'];",
    "const value = source.shape;",
    "const { shape: schemaFields } = schema;",
    "const model = { [external.responseShape]: input };",
  ],
  invalid: [
    { code: "const responseShape = input;", errors: [error] },
    { code: "function loadShape() { return value; }", errors: [error] },
    { code: "interface ResponseShape { value: string }", errors: [error] },
    { code: "class Example { responseShape = value; }", errors: [error] },
    { code: "class Example { #shapeCache = new Map(); }", errors: [error] },
    { code: "const ShapePanel = Panel; const view = <ShapePanel />;", errors: [error] },
    { code: "const model = { responseShape: input };", errors: [error] },
    { code: 'const model = { "responseShape": input };', errors: [error] },
    { code: 'interface Model { "responseShape": string }', errors: [error] },
    { code: 'class Model { ["responseShape"] = input; }', errors: [error] },
  ],
});
