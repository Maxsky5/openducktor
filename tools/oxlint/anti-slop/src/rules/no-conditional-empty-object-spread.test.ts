import { RuleTester } from "oxlint/plugins-dev";

import { noConditionalEmptyObjectSpreadRule } from "./no-conditional-empty-object-spread.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "avoid" };

if (noConditionalEmptyObjectSpreadRule.meta?.fixable !== undefined) {
  throw new Error("The rule must not offer an unsafe semantics-changing fix.");
}

tester.run(
  "anti-slop/no-conditional-empty-object-spread",
  noConditionalEmptyObjectSpreadRule,
  {
    valid: [
      "const result = { value };",
      "const result = { ...values };",
      "const result = condition ? { value } : {};",
      "function build(undefined: { value: string }) { return { ...(condition ? { value: 'set' } : undefined) }; }",
    ],
    invalid: [
      {
        code: "const result = { ...(value !== undefined ? { value } : {}) };",
        errors: [error],
      },
      {
        code: "const result = { ...(condition ? {} : { value }) };",
        errors: [error],
      },
      {
        code: "const result = { ...(value !== undefined ? { value } : undefined) };",
        errors: [error],
      },
      {
        code: "const result = { ...(condition ? undefined : { value }) };",
        errors: [error],
      },
      {
        code: "const result = { ...(condition ? (undefined) : { value }) };",
        errors: [error],
      },
    ],
  },
);
