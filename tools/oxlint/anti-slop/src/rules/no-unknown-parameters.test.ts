import { RuleTester } from "oxlint/plugins-dev";

import { noUnknownParametersRule } from "./no-unknown-parameters.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "unknownParameter" };

tester.run("anti-slop/no-unknown-parameters", noUnknownParametersRule, {
  valid: [
    "function load(input: User) { return input; }",
    "const fail = (cause: unknown) => cause;",
    "type Loader = (input: string) => void;",
    "function load(...parts: string[]) { return parts.join(''); }",
    "function load(...parts: unknown[]) { return parts; }",
  ],
  invalid: [
    { code: "function load(input: unknown) { return input; }", errors: [error] },
    { code: "const load = (input: unknown = source) => input;", errors: [error] },
    { code: "type Loader = (input: unknown) => void;", errors: [error] },
  ],
});
