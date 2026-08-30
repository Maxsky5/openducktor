import { RuleTester } from "oxlint/plugins-dev";
import { noForbiddenTermInSymbolNamesRule } from "./no-shape-in-symbol-names.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

tester.run("anti-slop/no-shape-in-symbol-names", noForbiddenTermInSymbolNamesRule, {
  valid: ["schema.shape", "schema?.shape"],
  invalid: [
    {
      code: "const responseShape = {};",
      errors: [{ messageId: "forbiddenSymbolName" }],
    },
  ],
});
