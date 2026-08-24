import { RuleTester } from "oxlint/plugins-dev";

import { noRuntimeTypeofRule } from "./no-runtime-typeof.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "runtimeTypeof" };
const allowInTypeGuards = [{ allowInTypeGuards: true }];

tester.run("anti-slop/no-runtime-typeof", noRuntimeTypeofRule, {
  valid: [
    "const value = input;",
    {
      code: 'function isString(value: unknown): value is string { return typeof value === "string"; }',
      options: allowInTypeGuards,
    },
    {
      code: 'const isString = (value: unknown): value is string => typeof value === "string";',
      options: allowInTypeGuards,
    },
    {
      code: 'function assertString(value: unknown): asserts value is string { if (typeof value !== "string") throw new Error(); }',
      options: allowInTypeGuards,
    },
    {
      code: 'if (typeof input === "string") use(input);',
      options: allowInTypeGuards,
    },
    {
      code: 'function parse(value: unknown): string { if (typeof value !== "string") throw new Error(); return value; }',
      options: allowInTypeGuards,
    },
    {
      code: 'function isString(value: unknown): value is string { const check = () => typeof value === "string"; return check(); }',
      options: allowInTypeGuards,
    },
  ],
  invalid: [
    { code: "const typeName = typeof input;", errors: [error] },
    {
      code: 'function isString(value: unknown): value is string { return typeof value === "string"; }',
      errors: [error],
    },
    {
      code: "if (typeof value === expectedType) use(value);",
      options: allowInTypeGuards,
      errors: [error],
    },
  ],
});
