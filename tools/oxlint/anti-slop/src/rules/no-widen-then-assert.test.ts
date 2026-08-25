import { RuleTester } from "oxlint/plugins-dev";

import { noWidenThenAssertRule } from "./no-widen-then-assert.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "widenThenAssert" };

tester.run("anti-slop/no-widen-then-assert", noWidenThenAssertRule, {
  valid: [
    "const source = { id: 'first' }; const widened: unknown = source; const parsed = widened as User;",
    "declare const input: unknown; const parsed = input as User;",
    "declare const input: unknown; let alias = input; alias = {}; const parsed = alias as User;",
    "declare const input: unknown; const alias = input; const parse = () => alias as User;",
    "type Record<Key, Value> = { value: Value }; declare const input: Record<string, unknown>; const alias = input; const parsed = alias as User;",
    "declare const input: Record<string, User>; const parsed = input as User;",
  ],
  invalid: [
    {
      code: "declare const input: unknown; const alias = input; const parsed = alias as User;",
      errors: [error],
    },
    {
      code: "declare const input: unknown; const first = input; const second = first; const parsed = (second) as User;",
      errors: [error],
    },
    {
      code: "type OpenValues = Readonly<Record<string, unknown>>; declare const input: OpenValues; const alias = input; const parsed = <User>(alias);",
      errors: [error],
    },
    {
      code: "function parse(input: unknown) { const alias = input; return alias as User; }",
      errors: [error],
    },
  ],
});
