import { RuleTester } from "oxlint/plugins-dev";
import { fileURLToPath } from "node:url";

import { noUnsafeDictionaryTypeRule } from "./no-unsafe-dictionary-type.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

const error = { messageId: "unsafeDictionary" };
const importedTypeFixtureFilename = fileURLToPath(
  new URL("./__fixtures__/no-known-value-widening-input.ts", import.meta.url),
);

tester.run("anti-slop/no-unsafe-dictionary-type", noUnsafeDictionaryTypeRule, {
  valid: [
    "type Commands = Record<string, Command>;",
    "type Metadata = Record<PropertyKey, JsonValue>;",
    "type PermissionLevels = Record<Permission, number>;",
    "type Indexed = { [key: string]: Command };",
    "type CompatibleIndexes = { [index: number]: Command; [key: string]: Command | OtherCommand };",
    "type Exhaustive = { [K in Permission]: number };",
    "type Allowed = Record<string, { payload: unknown }>;",
    "type UnknownValuesAreSafe = Record<string, unknown>;",
    "type UnknownIndexIsSafe = { readonly [key: string]: unknown };",
    "type UnknownMappedValuesAreSafe = { readonly [K in string]: unknown };",
    "type UnknownUnionIsSafe = { [index: number]: Command; [key: string]: unknown | Command };",
    "type NonNullableUnknownIsSafe = Record<string, NonNullable<unknown>>;",
    "type UnknownIntersectionIsSafe = Record<string, unknown & {}>;",
    "type AlsoAllowed = Record<string, Result<Data, unknown>>;",
    "type Index<T> = Record<string, T>; type EntityIndex<T extends Entity> = Record<string, T>;",
    "type Safe = Index<Command>; type Index<T> = Record<string, T>;",
    "type A = Map<string, unknown>; type B = ReadonlyMap<string, unknown>; type C = WeakMap<object, unknown>;",
    "import { Record } from './local'; type A = Record<string, unknown>;",
    "type Record<K, V> = { key: K; value: V }; type A = Record<string, unknown>;",
    "type Readonly<T> = { value: T }; type A = Record<string, Readonly<unknown>>;",
    "type NonNullable<T> = { value: T }; type A = Record<string, NonNullable<unknown>>;",
    "type Value<T> = T; type Index<T = Command, U = Value<T>> = Record<string, U>; type A = Index;",
    "interface Owner { readonly id: string } type A = Record<string, unknown & Owner>;",
    "interface Owner { readonly id: string } interface Child extends Owner {} type A = Record<string, Child>;",
    "interface Owner { readonly id: string } interface Child extends Owner { readonly __brand?: never } type A = Record<string, Child>;",
    "interface Escape {} interface Escape { readonly id: string } type A = Record<string, Escape>;",
    "interface Escape { readonly id: string } interface Escape {} type A = Record<string, Escape>;",
    "interface Owner { readonly id: string } type A = Record<string, object & Owner>;",
    "type Wrap<T> = { readonly wrapped: T }; type Inner<T, U> = { readonly value: T } & Wrap<U>; type Outer<T, U> = Record<string, Inner<T, U>>; declare function f<T, U>(): Outer<T, U>;",
    "function owner() { type Record<K, V> = { key: K; value: V }; type A = Record<string, object>; }",
    "namespace Owner { type Record<K, V> = { key: K; value: V }; type A = Record<string, object>; }",
    "type Box<T> = { [T in string]: T }; type Safe = Box<any>;",
    "type T = object; type Box = { [T in string]: T };",
    'class Escape { id = "x" } interface Escape {} type Safe = Record<string, Escape>;',
    'type Safe = Pick<Record<string, object>, "only">;',
    "type Safe = Omit<Record<string, object>, string>;",
    'interface Safe extends Record<"only", object> {}',
    'type Safe = Record<string & "only", object>;',
    'type Safe = Record<`key-${"one" | "two"}`, object>;',
    "type Safe = Record<`flag-${boolean}`, object>;",
    "type Safe = Record<`${null}-${undefined}`, object>;",
    {
      filename: importedTypeFixtureFilename,
      code: "import type { InputKey } from './no-known-value-widening-types'; type Safe = Pick<Record<string, object>, InputKey>;",
    },
  ],
  invalid: [
    { code: "type A = { [key: string]: any };", errors: [error] },
    {
      code: "function owner() { function Record() {} type A = Record<string, object>; }",
      errors: [error],
    },
    { code: "type A = { [K in PropertyKey]: object };", errors: [error] },
    { code: "type A = Record<string, {}>;", errors: [error] },
    { code: "type A = Record<keyof any, object>;", errors: [error] },
    { code: "type A = Record<keyof never, object>;", errors: [error] },
    { code: "type A = Record<string & keyof any, object>;", errors: [error] },
    { code: "type A = Record<`key-${string}`, object>;", errors: [error] },
    { code: "type A = Record<`id-${bigint}`, object>;", errors: [error] },
    {
      code: "type A = Record<`foo-${string}` & `${string}-bar`, object>;",
      errors: [error],
    },
    { code: "interface Escape {} type A = Record<string, Escape>;", errors: [error] },
    {
      code: "interface Escape { readonly __brand?: never } type A = Record<string, Escape>;",
      errors: [error],
    },
    {
      code: "type Escape = { readonly __brand?: never }; type A = Record<string, Escape>;",
      errors: [error],
    },
    { code: "type A = Record<string, { readonly __brand?: never }>;", errors: [error] },
    { code: "interface Escape {} type A = Record<string, string | Escape>;", errors: [error] },
    {
      code: "interface Owner { readonly id: string } type A = Record<string, any & Owner>;",
      errors: [error],
    },
    {
      code: "type Marker<T> = { readonly __brand?: never }; type Index<T, U = Marker<T>> = Record<string, U>; type A = Index<Item>;",
      errors: 1,
    },
    {
      code: "function owner() { type Escape = {}; type A = Record<string, Escape>; }",
      errors: [error],
    },
    {
      code: "namespace Owner { type Escape = {}; type A = Record<string, Escape>; }",
      errors: [error],
    },
    {
      code: "type Escape = {}; namespace Owner { type A = Record<string, Escape>; }",
      errors: [error],
    },
    {
      code: "type Index<T> = Record<string, T>; function owner() { type Escape = {}; type A = Index<Escape>; }",
      errors: [error],
    },
    {
      code: "interface Escape {} interface Escape {} type A = Record<string, Escape>;",
      errors: [error],
    },
    {
      code: "interface Escape {} namespace Escape { export const tag = true; } type A = Record<string, Escape>;",
      errors: [error],
    },
    {
      code: "interface Parent {} interface Escape extends Parent {} type A = Record<string, Escape>;",
      errors: [error],
    },
    {
      code: "class Escape {} type A = Record<string, Escape>;",
      errors: [error],
    },
    {
      code: "namespace Owner { export class Empty {} } type Bad = Record<string, Owner.Empty>;",
      errors: [error],
    },
    {
      code: "interface Escape extends Record<string, any> {}",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import type { BroadObject } from './no-known-value-widening-types'; type Unsafe = Record<string, BroadObject>;",
      errors: [error],
    },
    {
      code: "type Unsafe = Pick<Record<string, object>, string>;",
      errors: [error],
    },
    {
      code: 'type Unsafe = Omit<Record<string, object>, "reserved">;',
      errors: [error],
    },
    {
      code: 'type Unsafe = Pick<{ nested: Record<string, object> }, "nested">;',
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import type { Identity } from './no-known-value-widening-types'; type Unsafe = Identity<Record<string, object>>;",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import type { StringKey } from './no-known-value-widening-types'; type Unsafe = Pick<Record<string, object>, StringKey>;",
      errors: [error],
    },
  ],
});
