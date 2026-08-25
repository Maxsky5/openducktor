import { RuleTester } from "oxlint/plugins-dev";
import { fileURLToPath } from "node:url";

import { noObjectParametersRule } from "./no-object-parameters.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "objectParameter" };
const importedTypeFixtureFilename = fileURLToPath(
  new URL("./__fixtures__/no-object-parameter-input.ts", import.meta.url),
);

tester.run("anti-slop/no-object-parameters", noObjectParametersRule, {
  valid: [
    "type Alias = object;",
    "function f(value: Alias) {}",
    "interface Owner { readonly id: string } function f(value: Owner) {}",
    "function f<Value>(value: Value) {}",
    "function f<Value extends object>(value: Value) {}",
    "function f<Value extends Owner, Owner extends { readonly id: string }>(value: Value) {}",
    "type Owner = { readonly id: string }; function f<Value extends Owner>(value: Value) {}",
    "type Alias = object; function consume<Alias>(value: Alias) {}",
    "type Alias = object; type Consumer<Alias> = (value: Alias) => void;",
    "type Alias = object; interface Consumer<Alias> { consume(value: Alias): void }",
    "type Key = object; type Mapped<Input> = { [Key in keyof Input]: (value: Key) => void };",
    "type Item = object; type Unpacked<Input> = Input extends Promise<infer Item> ? (value: Item) => void : never;",
    "type Value = object; function outer() { type Value = { id: string }; function read(value: Value): void {} }",
    "namespace Owner { type Value = { id: string }; export function read(value: Value): void {} }",
    {
      filename: importedTypeFixtureFilename,
      code: "import type { KnownOwner } from './no-known-value-widening-types'; function f(value: KnownOwner) {}",
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import type * as Types from './no-known-value-widening-types'; function f(value: Types.OwnerTypes.KnownOwner) {}",
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import type { BroadObject as Value } from './no-known-value-widening-types'; function f<Value>(value: Value) {}",
    },
  ],
  invalid: [
    { code: "function f(value: object) {}", errors: [error] },
    { code: "type Alias = object; function f(value: Alias) {}", errors: [error] },
    { code: "type Alias = (object); function f(value: Alias) {}", errors: [error] },
    { code: "function f(value: Readonly<object>) {}", errors: [error] },
    { code: "type Box<T> = T; function f(value: Box<object>) {}", errors: [error] },
    {
      code: "function outer() { type Payload = object; function read(value: Payload): void {} }",
      errors: [error],
    },
    {
      code: "namespace Owner { type Payload = object; export function read(value: Payload): void {} }",
      errors: [error],
    },
    {
      code: "namespace Owner { export type Payload = object; } function read(value: Owner.Payload): void {}",
      errors: [error],
    },
    {
      code: "type Item = object; type Fallback<Input> = Input extends infer Item ? string : (value: Item) => void;",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import type { BroadObject } from './no-known-value-widening-types'; function f(value: BroadObject) {}",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import type { BroadObject } from './no-object-parameter-reexports'; function f(value: BroadObject) {}",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import type * as Types from './no-known-value-widening-types'; function f(value: Types.OwnerTypes.BroadObject) {}",
      errors: [error],
    },
  ],
});
