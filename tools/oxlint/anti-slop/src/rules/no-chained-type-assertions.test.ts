import { RuleTester } from "oxlint/plugins-dev";

import { noChainedTypeAssertionsRule } from "./no-chained-type-assertions.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "chained" };

tester.run("anti-slop/no-chained-type-assertions", noChainedTypeAssertionsRule, {
  valid: [
    "const value = input as User;",
    "const value = <User>input;",
    "const value = ({ count: 1 } as const);",
    "const value = (({ count: 1 }) as const) as const;",
  ],
  invalid: [
    { code: "const value = input as unknown as User;", errors: [error] },
    { code: "const value = (input as unknown) as User;", errors: [error] },
    { code: "const value = <User><unknown>input;", errors: [error] },
    { code: "const value = ((input as Foo)) as Bar;", errors: [error] },
    { code: "const value = ((input as unknown)!) as User;", errors: [error] },
    { code: "const value = (<unknown>input)! as User;", errors: [error] },
  ],
});
