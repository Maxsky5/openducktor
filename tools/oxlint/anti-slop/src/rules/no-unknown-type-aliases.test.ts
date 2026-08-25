import { RuleTester } from "oxlint/plugins-dev";
import { fileURLToPath } from "node:url";

import { noUnknownTypeAliasesRule } from "./no-unknown-type-aliases.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "unknownAlias" };
const importedTypeFixtureFilename = fileURLToPath(
  new URL("./__fixtures__/no-known-value-widening-input.ts", import.meta.url),
);
const inferredSymbolFixtureFilename = fileURLToPath(
  new URL("./__fixtures__/no-known-value-widening-inferred-symbol-input.ts", import.meta.url),
);

tester.run("anti-slop/no-unknown-type-aliases", noUnknownTypeAliasesRule, {
  valid: [
    "type User = { readonly id: string };",
    "type Empty = Record<string, unknown>[never];",
    "type Allowed = unknown | any;",
    'type Allowed = { input: unknown | any }["input"];',
    'type Known = { [key: string]: unknown; known: string }["known"];',
    "type Known = { [key: string]: unknown; [key: number]: string }[number];",
    "type Alias = string; type UserId = Alias;",
    {
      filename: importedTypeFixtureFilename,
      code: "import { otherToken as local, type UniqueSymbolPayload } from './no-known-value-widening-types'; type Known = UniqueSymbolPayload[typeof local];",
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import { token, type UniqueSymbolPayload } from './no-known-value-widening-types'; function owner() { const token = 'known' as const; type Known = UniqueSymbolPayload[typeof token]; }",
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import type { token, UniqueSymbolPayload } from './no-known-value-widening-types'; function owner(token: 'known') { type Known = UniqueSymbolPayload[typeof token]; }",
    },
    "namespace Owner { export const token = Symbol(); } function owner(Owner: { token: 'known' }) { type Known = { known: string }[typeof Owner.token]; }",
    "function owner(Symbol: () => symbol) { const token = Symbol(); type Known = { [key: symbol]: string }[typeof token]; }",
    'import type { Payload } from "./types"; function owner() { type Payload = string; type Local = Payload; }',
  ],
  invalid: [
    { code: "type Alias = unknown;", errors: [error] },
    { code: "type Current = unknown;", errors: [error] },
    {
      code: "declare const input: unknown; type Hidden = typeof input;",
      errors: [error],
    },
    { code: 'type Hidden = { input: unknown }["input"];', errors: [error] },
    {
      code: "declare const token: unique symbol; type Hidden = { [token]: unknown }[typeof token];",
      errors: [error],
    },
    {
      code: "const token = Symbol(); type Hidden = { [token]: unknown }[typeof token];",
      errors: [error],
    },
    {
      code: "const token = Symbol(); const alias: typeof token = token; type Hidden = Record<typeof alias, unknown>[typeof alias];",
      errors: [error],
    },
    {
      code: "const token = Symbol(); function owner(Symbol: () => symbol) { type Hidden = { [token]: unknown }[typeof token]; }",
      errors: [error],
    },
    {
      code: "function owner() { const token = Symbol(); type Hidden = Record<typeof token, unknown>[typeof token]; }",
      errors: [error],
    },
    {
      code: "const token = Symbol(); type Payload = { [token]: unknown; known: string }; type Hidden = Pick<Payload, typeof token>[typeof token];",
      errors: [error],
    },
    {
      code: "const token = Symbol(); type Payload = { [token]: unknown; known: string }; type Hidden = Omit<Payload, 'known'>[typeof token];",
      errors: [error],
    },
    {
      code: "const token = Symbol(); type Payload = { [token]: unknown }; type Keys = keyof Payload; type Hidden = Payload[Keys];",
      errors: [error],
    },
    {
      code: "declare const token: unique symbol; type Hidden = Record<typeof token, unknown>[typeof token];",
      errors: [error],
    },
    {
      code: "declare const token: unique symbol; type Hidden = { [Key in typeof token]: unknown }[typeof token];",
      errors: [error],
    },
    {
      code: "declare const token: unique symbol; declare const other: unique symbol; type Keys = typeof token | typeof other; type Hidden = Record<Keys, unknown>[typeof token];",
      errors: [error],
    },
    {
      code: "namespace Owner { export declare const token: unique symbol; } type Hidden = Record<typeof Owner.token, unknown>[typeof Owner.token];",
      errors: [error],
    },
    {
      code: "type Hidden = { [key: `pre-${string}`]: unknown }[`pre-${number}-${string}`];",
      errors: [error],
    },
    {
      code: "type Hidden = { [key: string]: unknown; [key: number]: string }[string];",
      errors: [error],
    },
    {
      code: "type Hidden = { [key: string]: unknown }[number];",
      errors: [error],
    },
    {
      code: "type Hidden = Record<string, unknown>[number];",
      errors: [error],
    },
    {
      code: "type Hidden = { [key: string]: unknown; known: string }[string];",
      errors: [error],
    },
    { code: "type Hidden = [string, ...unknown[]][number];", errors: [error] },
    { code: "type Hidden = [...string[], unknown][0];", errors: [error] },
    { code: "type Hidden = [...[unknown, string], number][0];", errors: [error] },
    {
      code: "type Tail = [unknown, string]; type Hidden = [...Tail][0];",
      errors: [error],
    },
    {
      code: "type Hidden = [...([unknown, string] | [number])][0];",
      errors: [error],
    },
    {
      code: "type Tail = [string] | unknown[]; type Spread = [...Tail]; type Hidden = Spread[0];",
      errors: [error],
    },
    {
      code: 'type Source = { a: unknown; b: string }; type Copy = { [K in keyof Source]: Source[K] }; type Hidden = Copy["a"];',
      errors: [error],
    },
    {
      code: 'type Source = { a: unknown; b: string }; type Copy = { [K in keyof Source]: Source[K] | string }; type Hidden = Copy["a"];',
      errors: [error],
    },
    {
      code: 'interface Box<Value> { value: Value } type Source = { a: unknown }; type Copy = { [K in keyof Source]: Box<Source[K]> }; type Hidden = Copy["a"]["value"];',
      errors: [error],
    },
    {
      code: 'type Source = { a: unknown }; type Copy = { [K in keyof Source]: Record<"value", Source[K]> }; type Hidden = Copy["a"]["value"];',
      errors: [error],
    },
    {
      code: "declare const key: string; type Hidden = Record<string, unknown>[typeof key];",
      errors: [error],
    },
    {
      code: "declare const key: number; type Hidden = Record<number, unknown>[typeof key];",
      errors: [error],
    },
    {
      code: "declare const key: symbol; type Hidden = Record<symbol, unknown>[typeof key];",
      errors: [error],
    },
    {
      code: "declare const key: 'input' | 'other'; type Hidden = Record<typeof key, unknown>[typeof key];",
      errors: [error],
    },
    {
      code: "const key = 'input'; type Hidden = { input: unknown }[typeof key];",
      errors: [error],
    },
    {
      code: "let key = 'input'; type Hidden = Record<string, unknown>[typeof key];",
      errors: [error],
    },
    {
      code: "const key = Math.random() > 0.5 ? 'input' : 'other'; type Hidden = Record<typeof key, unknown>[typeof key];",
      errors: [error],
    },
    {
      code: "const key = 'input' as const; type Hidden = { input: unknown }[typeof key];",
      errors: [error],
    },
    {
      code: "const key = -1; type Hidden = { [-1]: unknown }[typeof key];",
      errors: [error],
    },
    {
      code: "function owner(key: string) { type Hidden = Record<string, unknown>[typeof key]; }",
      errors: [error],
    },
    {
      code: "declare const Keys: { key: string }; type Hidden = Record<string, unknown>[typeof Keys.key];",
      errors: [error],
    },
    {
      code: "declare const Keys: { nested: { key: string } }; type Hidden = Record<string, unknown>[typeof Keys.nested.key];",
      errors: [error],
    },
    {
      code: "namespace Keys { export declare const key: string; } type Hidden = Record<string, unknown>[typeof Keys.key];",
      errors: [error],
    },
    {
      code: "function owner(Keys: { key: string }) { type Hidden = Record<string, unknown>[typeof Keys.key]; }",
      errors: [error],
    },
    {
      code: "const Keys = { key: 'input' } as const; type Hidden = { input: unknown }[typeof Keys.key];",
      errors: [error],
    },
    {
      code: "declare const Keys: { [key: string]: string }; type Hidden = Record<string, unknown>[typeof Keys.input];",
      errors: [error],
    },
    {
      code: "declare const Keys: { key: string } & { other: number }; type Hidden = Record<string, unknown>[typeof Keys.key];",
      errors: [error],
    },
    {
      code: "interface BaseKeys { key: string } interface Keys extends BaseKeys {} declare const keys: Keys; type Hidden = Record<string, unknown>[typeof keys.key];",
      errors: [error],
    },
    {
      code: "function owner({ key }: { key: string }) { type Hidden = Record<string, unknown>[typeof key]; }",
      errors: [error],
    },
    {
      code: "function owner([key]: [string]) { type Hidden = Record<string, unknown>[typeof key]; }",
      errors: [error],
    },
    {
      code: "function owner({ source: key = 'input' }: { source: string }) { type Hidden = Record<string, unknown>[typeof key]; }",
      errors: [error],
    },
    {
      code: "function owner({ ignored, ...rest }: { ignored: number; key: string }) { type Hidden = Record<string, unknown>[typeof rest.key]; }",
      errors: [error],
    },
    {
      code: "function owner(...[key]: [string]) { type Hidden = Record<string, unknown>[typeof key]; }",
      errors: [error],
    },
    {
      code: "const { key }: { key: string } = { key: 'input' }; type Hidden = Record<string, unknown>[typeof key];",
      errors: [error],
    },
    {
      code: "const [key]: string[] = ['input']; type Hidden = Record<string, unknown>[typeof key];",
      errors: [error],
    },
    {
      code: "declare const source: { key: string }; const { key } = source; type Hidden = Record<string, unknown>[typeof key];",
      errors: [error],
    },
    {
      code: "declare const source: [string]; const [key] = source; type Hidden = Record<string, unknown>[typeof key];",
      errors: [error],
    },
    {
      code: "const [ignored, ...rest] = [0, 'input'] as const; type Hidden = Record<string, unknown>[typeof rest[number]];",
      errors: [error],
    },
    {
      code: "declare const source: readonly [number, string]; const [ignored, ...rest] = source; type Hidden = Record<string, unknown>[typeof rest[number]];",
      errors: [error],
    },
    {
      code: "declare const source: { value: string }; const { value: key = 'input' } = source; type Hidden = Record<string, unknown>[typeof key];",
      errors: [error],
    },
    {
      code: "declare const source: { ignored: number; key: string }; const { ignored, ...rest } = source; type Hidden = Record<string, unknown>[typeof rest.key];",
      errors: [error],
    },
    {
      code: "declare const key: string & unknown; type Hidden = Record<string, unknown>[typeof key];",
      errors: [error],
    },
    {
      code: "declare const Keys: { key: string & unknown }; type Hidden = Record<string, unknown>[typeof Keys.key];",
      errors: [error],
    },
    {
      code: "interface BaseKeys { key: string & unknown } interface Keys extends BaseKeys {} declare const keys: Keys; type Hidden = Record<string, unknown>[typeof keys.key];",
      errors: [error],
    },
    {
      code: "const base = { key: 'input' } as const; const Keys = { ...base } as const; type Hidden = { input: unknown }[typeof Keys.key];",
      errors: [error],
    },
    {
      code: "const propertyName = 'key' as const; const Keys = { [propertyName]: 'input' } as const; type Hidden = { input: unknown }[typeof Keys.key];",
      errors: [error],
    },
    {
      code: "const Keys = { [`key`]: `input` } as const; type Hidden = { input: unknown }[typeof Keys.key];",
      errors: [error],
    },
    {
      code: "const Keys = { [-1]: 'input' } as const; type Hidden = { input: unknown }[typeof Keys[-1]];",
      errors: [error],
    },
    {
      code: "const base = { key: 'other' } as const; const Keys = { ...base, key: 'input' } as const; type Hidden = { input: unknown }[typeof Keys.key];",
      errors: [error],
    },
    {
      code: "const base = { key: 'other' } as const; const Keys = { key: 'input', ...base } as const; type Hidden = { other: unknown }[typeof Keys.key];",
      errors: [error],
    },
    {
      code: "declare const base: { key?: 'input' }; const Keys = { key: 'other', ...base } as const; type Hidden = { input: string; other: unknown }[typeof Keys.key];",
      errors: [error],
    },
    {
      code: "declare const base: { key: 'input' } | {}; const Keys = { key: 'other', ...base } as const; type Hidden = { input: string; other: unknown }[typeof Keys.key];",
      errors: [error],
    },
    {
      code: 'type Source = { a: unknown }; type Copy = { [K in keyof Source]: { [J in K]: Source[K] } }; type Hidden = Copy["a"]["a"];',
      errors: [error],
    },
    {
      code: 'type Source = { a: unknown }; type Copy = { [K in keyof Source]: Record<keyof Record<K, unknown>, Source[K]> }; type Hidden = Copy["a"]["a"];',
      errors: [error],
    },
    {
      code: 'type Hidden = { [K in "safe" as "input"]: unknown }["input"];',
      errors: [error],
    },
    {
      code: 'type Hidden = Pick<{ input: unknown; other: string }, "input">["input"];',
      errors: [error],
    },
    {
      code: 'type Hidden = Omit<{ input: unknown; other: string }, "other">["input"];',
      errors: [error],
    },
    {
      code: 'interface Payload { input: unknown } type Hidden = Readonly<Payload>["input"];',
      errors: [error],
    },
    { code: "type UnknownValue = unknown; type Alias = UnknownValue;", errors: [error, error] },
    { code: "function owner() { type Payload = unknown; }", errors: [error] },
    { code: "namespace Owner { export type Payload = unknown; }", errors: [error] },
    {
      filename: importedTypeFixtureFilename,
      code: "import type { UnknownArray } from './no-known-value-widening-types'; type Hidden = UnknownArray[number];",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import { stringKey } from './no-known-value-widening-types'; type Hidden = Record<string, unknown>[typeof stringKey];",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import { stringKey as localKey } from './no-known-value-widening-types'; type Hidden = Record<string, unknown>[typeof localKey];",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import { stringKey } from './no-known-value-widening-types'; const alias = stringKey; type Hidden = Record<string, unknown>[typeof alias];",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import * as Types from './no-known-value-widening-types'; const alias = Types.stringKey; type Hidden = Record<string, unknown>[typeof alias];",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import * as Types from './no-known-value-widening-types'; const Alias = Types; type Hidden = Record<string, unknown>[typeof Alias.stringKey];",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import * as Types from './no-known-value-widening-types'; const { stringKey } = Types; type Hidden = Record<string, unknown>[typeof stringKey];",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import * as Types from './no-known-value-widening-types'; type Hidden = Record<string, unknown>[typeof Types.stringKey];",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import { keyOwner } from './no-known-value-widening-types'; type Hidden = Record<string, unknown>[typeof keyOwner.key];",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import { reexportedStringKey } from './no-known-value-widening-reexports'; type Hidden = Record<string, unknown>[typeof reexportedStringKey];",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import { stringKey } from './no-known-value-widening-star-reexports'; type Hidden = Record<string, unknown>[typeof stringKey];",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import * as Reexports from './no-known-value-widening-namespace-reexports'; type Hidden = Record<string, unknown>[typeof Reexports.SymbolTypes.stringKey];",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "type Hidden = Record<string, unknown>[typeof import('./no-known-value-widening-types').stringKey];",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import { token as local, type UniqueSymbolPayload } from './no-known-value-widening-types'; type Hidden = UniqueSymbolPayload[typeof local];",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import type { token, UniqueSymbolPayload } from './no-known-value-widening-types'; type Hidden = UniqueSymbolPayload[typeof token];",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import type { UniqueSymbolPayload } from './no-known-value-widening-types'; type Hidden = UniqueSymbolPayload[typeof import('./no-known-value-widening-types').token];",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import * as Types from './no-known-value-widening-types'; type Hidden = Types.UniqueSymbolPayload[typeof Types.token];",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import * as Types from './no-known-value-widening-types'; const Alias = Types; const local = Alias.token; type Hidden = Types.UniqueSymbolPayload[typeof local];",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import * as Types from './no-known-value-widening-types'; const Alias = Types; const { token: local } = Alias; type Hidden = Types.UniqueSymbolPayload[typeof local];",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import { token as local } from './no-known-value-widening-types'; type Hidden = Record<typeof local, unknown>[typeof local];",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import { token as local } from './no-known-value-widening-types'; type Hidden = { [Key in typeof local]: unknown }[typeof local];",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import { token as local, type UniqueSymbolPayload } from './no-known-value-widening-types'; type Hidden = Pick<UniqueSymbolPayload, typeof local>[typeof local];",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import { token as local, type UniqueSymbolPayload } from './no-known-value-widening-types'; type Hidden = Omit<UniqueSymbolPayload, 'known'>[typeof local];",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import type { UniqueSymbolPayload } from './no-known-value-widening-types'; type Keys = keyof UniqueSymbolPayload; type Hidden = UniqueSymbolPayload[Keys];",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import { reexportedToken, type UniqueSymbolPayload } from './no-known-value-widening-reexports'; type Hidden = UniqueSymbolPayload[typeof reexportedToken];",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import { token, type UniqueSymbolPayload } from './no-known-value-widening-star-reexports'; type Hidden = UniqueSymbolPayload[typeof token];",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import * as Reexports from './no-known-value-widening-namespace-reexports'; type Hidden = Reexports.SymbolTypes.UniqueSymbolPayload[typeof Reexports.SymbolTypes.token];",
      errors: [error],
    },
    {
      filename: inferredSymbolFixtureFilename,
      code: "import { inferredToken, type InferredSymbolPayload } from './no-known-value-widening-inferred-symbol'; type Hidden = InferredSymbolPayload[typeof inferredToken];",
      errors: [error],
    },
    {
      filename: inferredSymbolFixtureFilename,
      code: "import { inferredToken } from './no-known-value-widening-inferred-symbol'; type Hidden = Record<typeof inferredToken, unknown>[typeof inferredToken];",
      errors: [error],
    },
    {
      filename: inferredSymbolFixtureFilename,
      code: "import { inferredToken } from './no-known-value-widening-inferred-symbol'; type Hidden = { [K in typeof inferredToken]: unknown }[typeof inferredToken];",
      errors: [error],
    },
    {
      filename: inferredSymbolFixtureFilename,
      code: "import { inferredToken, type InferredSymbolPayload } from './no-known-value-widening-inferred-symbol'; type Hidden = Pick<InferredSymbolPayload, typeof inferredToken>[typeof inferredToken];",
      errors: [error],
    },
    {
      filename: inferredSymbolFixtureFilename,
      code: "import { inferredToken, type InferredSymbolPayload } from './no-known-value-widening-inferred-symbol'; type Hidden = Omit<InferredSymbolPayload, 'known'>[typeof inferredToken];",
      errors: [error],
    },
    {
      filename: inferredSymbolFixtureFilename,
      code: "import type { InferredSymbolPayload } from './no-known-value-widening-inferred-symbol'; type Keys = keyof InferredSymbolPayload; type Hidden = InferredSymbolPayload[Keys];",
      errors: [error],
    },
  ],
});
