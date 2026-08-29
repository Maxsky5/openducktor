import { RuleTester } from "oxlint/plugins-dev";

import { noWidenThenAssertRule } from "./no-widen-then-assert.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "widenThenAssert" };

tester.run("anti-slop/no-widen-then-assert", noWidenThenAssertRule, {
  valid: [
    "type User = { id: string }; function keep(source: User) { const widened: unknown = source; return widened; }",
    "declare const input: unknown; const parsed = input as { readonly id: string };",
    "type Broad = unknown; declare const input: Broad; const widened: Broad = input; const parsed = widened as { id: string };",
  ],
  invalid: [
    {
      code: "type Broad = unknown; type User = { id: string }; function parse(source: User) { const widened: Broad = source; return widened as User; }",
      errors: [error],
    },
    {
      code: "type User = { id: string }; const source: User = { id: 'second' }; const widened = source as unknown; const parsed = widened as User;",
      errors: [error],
    },
  ],
});
