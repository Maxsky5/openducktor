import { RuleTester } from "oxlint/plugins-dev";
import { fileURLToPath } from "node:url";

import { noUnknownTypeAliasesRule } from "./no-unknown-type-aliases.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "unknownAlias" };
const importedTypeFixtureFilename = fileURLToPath(
  new URL("./__fixtures__/no-known-value-widening-input.ts", import.meta.url),
);

tester.run("anti-slop/no-unknown-type-aliases", noUnknownTypeAliasesRule, {
  valid: [
    "type User = { readonly id: string };",
    "type Alias = string; type UserId = Alias;",
    'import type { Payload } from "./types"; function owner() { type Payload = string; type Local = Payload; }',
  ],
  invalid: [
    { code: "type Alias = unknown;", errors: [error] },
    { code: "type Current = unknown;", errors: [error] },
    { code: "type UnknownValue = unknown; type Alias = UnknownValue;", errors: [error, error] },
    { code: "function owner() { type Payload = unknown; }", errors: [error] },
    { code: "namespace Owner { export type Payload = unknown; }", errors: [error] },
    {
      filename: importedTypeFixtureFilename,
      code: "import type { UnknownArray } from './no-known-value-widening-types'; type Hidden = UnknownArray[number];",
      errors: [error],
    },
  ],
});
