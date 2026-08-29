import { RuleTester } from "oxlint/plugins-dev";

import { noUnknownParametersRule } from "./no-unknown-parameters.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "unknownParameter" };

tester.run("anti-slop/no-unknown-parameters", noUnknownParametersRule, {
  valid: [
    "function parseUser(input: unknown) { return userSchema.parse(input); }",
    "function readText(input: unknown): string | null { return typeof input === 'string' ? input : null; }",
    "function consume(value: unknown) { report(value); }",
    "function errorMessage(value: unknown): string { return String(value); }",
    "function typed(value: User) { return value; }",
  ],
  invalid: [
    { code: "function load(input: unknown) { return input; }", errors: [error] },
    {
      code: "function load(input: unknown | string) { return { input }; }",
      errors: [error],
    },
    {
      code: "function load(input: unknown) { const alias = input; return alias; }",
      errors: [error],
    },
    {
      code: "function unsafe(input: unknown): User { return input as User; }",
      errors: [error],
    },
    { code: "const load = (input: unknown) => input;", errors: [error] },
  ],
});
