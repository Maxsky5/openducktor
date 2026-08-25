import { RuleTester } from "oxlint/plugins-dev";

import { noUnknownReturnsRule } from "./no-unknown-returns.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "unknownReturn" };

tester.run("anti-slop/no-unknown-returns", noUnknownReturnsRule, {
  valid: [
    "type ImportedValue = unknown;",
    "function parse(): ImportedValue { return input; }",
    "function parse(): User { return user; }",
    "function infer() { return input; }",
    "function inferFromCall() { return importedUnknownSource(); }",
    "function inferFromVariable() { const value = importedUnknownSource(); return value; }",
    "function generic<Value>(): Value { return value; }",
    "type Value = unknown; function generic<Value>(): Value { return value; }",
    "type Key = unknown; type Mapped<Input> = { [Key in keyof Input]: () => Key };",
    "type Item = unknown; type Unpacked<Input> = Input extends Promise<infer Item> ? () => Item : never;",
    "function cause(): { cause: unknown } { return { cause: input }; }",
    "type Result = { value: unknown }; function load(): Result { return result; }",
    "function load(): Promise<User> { return promise; }",
    "function load(): Record<string, User>[string] { return user; }",
    "type KnownRecord = Record<string, User>; function load(): KnownRecord[string] { return user; }",
    "function owner() { type Promise<T> = { value: T }; const load = (): Promise<unknown> => ({ value }); }",
    "namespace Owner { type Promise<T> = { value: T }; const load = (): Promise<unknown> => ({ value }); }",
  ],
  invalid: [
    { code: "function load(): unknown { return input; }", errors: [error] },
    { code: "const load = (): unknown => input;", errors: [error] },
    { code: "type Loader = () => unknown;", errors: [error] },
    { code: "interface Loader { load(): unknown }", errors: [error] },
    { code: "declare function load(): unknown;", errors: [error] },
    { code: "function load(): string | unknown { return input; }", errors: [error] },
    { code: "function load(): Promise<unknown> { return promise; }", errors: [error] },
    {
      code: "type UnknownValue = unknown; function load(): UnknownValue { return input; }",
      errors: [error],
    },
    {
      code: "type UnknownRecord = Record<string, unknown>; function load(): UnknownRecord[string] { return input; }",
      errors: [error],
    },
    {
      code: "function load(): Record<string, unknown>[string] { return input; }",
      errors: [error],
    },
    {
      code: "function owner() { type Payload = unknown; const load = (): Payload => value; }",
      errors: [error],
    },
    {
      code: "namespace Owner { type Payload = unknown; const load = (): Payload => value; }",
      errors: [error],
    },
    {
      code: "function owner() { function Promise() {} const load = (): Promise<unknown> => value; }",
      errors: [error],
    },
    {
      code: "type Box<T> = Promise<T>; function owner() { type Payload = unknown; const load = (): Box<Payload> => value; }",
      errors: [error],
    },
    {
      code: "type Item = unknown; type Fallback<Input> = Input extends infer Item ? string : () => Item;",
      errors: [error],
    },
  ],
});
