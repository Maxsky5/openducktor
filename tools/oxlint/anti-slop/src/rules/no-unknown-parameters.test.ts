import { RuleTester } from "oxlint/plugins-dev";
import { fileURLToPath } from "node:url";

import { noUnknownParametersRule } from "./no-unknown-parameters.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "unknownParameter" };
const importedTypeFixtureFilename = fileURLToPath(
  new URL("./__fixtures__/no-known-value-widening-input.ts", import.meta.url),
);

tester.run("anti-slop/no-unknown-parameters", noUnknownParametersRule, {
  valid: [
    "function load(input: User) { return input; }",
    "function parseUser(input: unknown) { return userSchema.parse(input); }",
    "function parseUser(input: unknown): User { return userSchema.parse(input); }",
    "function readText(input: unknown): string | null { return typeof input === 'string' ? input : null; }",
    "function readError(input: unknown): Error | null { if (!(input instanceof Error)) return null; return input; }",
    "function isUser(input: unknown): input is User { return userSchema.safeParse(input).success; }",
    "const isLabel = (input: unknown): boolean => typeof input === 'string';",
    "function logValues(...parts: unknown[]) { console.log(...parts); }",
    "type UnknownConsumer = (value: unknown) => void;",
    "function consumeUnknown(value: unknown) { report(value); }",
    "promise.catch((error: unknown) => toDomainError(error));",
    "function errorMessage(value: unknown): string { return String(value); }",
    "function read(value: unknown) { { const value = 1; return value; } }",
    "function read(value: unknown) { return ((value: number) => value)(1); }",
    "function read(value: unknown) { try { throw 1; } catch (value) { return value; } }",
    "function safe(input: unknown) { const loop = () => { return loop; }; return loop; }",
    "function safe(input: unknown) { const loop = function () { return loop; }; return loop; }",
    "function safe({ input }: { input: unknown }) { return userSchema.parse(input); }",
    "function safe({ input }: { input: unknown }) { { const input = 1; return input; } }",
    "type First = Second; type Second = First; function safe({ input }: First) { return 1; }",
    "interface Base { input: string } interface Payload extends Base {} function safe({ input }: Payload) { return input; }",
    "function safe({ input }: { input: unknown } & { input: string }) { return input; }",
    "type First = Second; type Second = First; function safe({ input }: First) { return input; }",
    "type Omit<T, K> = { input: string }; function safe({ input }: Omit<{ input: unknown }, 'other'>) { return input; }",
    "type Box<T> = { [T in 'input']: T }; function safe({ input }: Box<unknown>) { return input; }",
    'function safe({ only }: Record<string & "only", string>) { return only; }',
    'function safe({ stop }: Record<Exclude<"start" | "stop", "stop">, unknown>) { return stop; }',
    'type Exclude<T, U> = "only"; function safe({ input }: Record<Exclude<string, "reserved">, unknown>) { return input; }',
    "function safe({ NaN: input }: Record<`${number}`, unknown>) { return input; }",
    "function safe({ Infinity: input }: Record<`${number}`, unknown>) { return input; }",
    'function safe({ "-Infinity": input }: Record<`${number}`, unknown>) { return input; }',
    'function safe({ "": input }: Record<`${number}`, unknown>) { return input; }',
    'function safe({ "+1": input }: Record<`${bigint}`, unknown>) { return input; }',
    'function safe({ "01": input }: Record<`${bigint}`, unknown>) { return input; }',
  ],
  invalid: [
    { code: "function load(input: unknown) { return input; }", errors: [error] },
    {
      code: "function unsafe(input: unknown): unknown & unknown { return input; }",
      errors: [error],
    },
    { code: "function load(input: unknown | string) { return input; }", errors: [error] },
    {
      code: "function load(input: unknown) { const alias = input; return alias; }",
      errors: [error],
    },
    {
      code: "function load(input: unknown) { let alias = input; return alias; }",
      errors: [error],
    },
    { code: "const load = (input: unknown = source) => input;", errors: [error] },
    {
      code: "function load(input: unknown) { return { input }; }",
      errors: [error],
    },
    {
      code: "function load(input: unknown) { return [input]; }",
      errors: [error],
    },
    {
      code: "function load(input: unknown) { return input.value; }",
      errors: [error],
    },
    {
      code: "function load(input: unknown) { return useCache ? cached : input; }",
      errors: [error],
    },
    {
      code: "function load(input: unknown) { schema.parse(input); return input; }",
      errors: [error],
    },
    {
      code: "promise.catch((error: unknown) => ({ error }));",
      errors: [error],
    },
    {
      code: "z.preprocess((input: unknown) => ({ value: input }), schema);",
      errors: [error],
    },
    {
      code: "function unsafe(input: unknown): User { return input as User; }",
      errors: [error],
    },
    {
      code: "function unsafe(input: unknown): void { consume(input as User); }",
      errors: [error],
    },
    {
      code: "type User = { id: string }; function unsafe(input: unknown): User { return input! as User; }",
      errors: [error],
    },
    {
      code: "type User = { id: string }; function unsafe(input: unknown): User { return (input satisfies unknown) as User; }",
      errors: [error],
    },
    {
      code: "function unsafe(input: unknown): any { return input; }",
      errors: [error],
    },
    {
      code: "function unsafe(input: unknown) { return () => input; }",
      errors: [error],
    },
    {
      code: "function unsafe(input: unknown) { function leak() { return input; } return leak; }",
      errors: [error],
    },
    {
      code: "function unsafe({ input }: { input: unknown }) { return input; }",
      errors: [error],
    },
    {
      code: "const unsafe = ({ input }: { input: unknown }) => input;",
      errors: [error],
    },
    {
      code: "function unsafe({ input: value }: { input: unknown }) { return value; }",
      errors: [error],
    },
    {
      code: "function unsafe({ nested: { input } }: { nested: { input: unknown } }) { return input; }",
      errors: [error],
    },
    {
      code: "function unsafe({ input = source }: { input?: unknown }) { return input; }",
      errors: [error],
    },
    {
      code: "function unsafe([input]: [unknown]) { return input; }",
      errors: [error],
    },
    {
      code: "function unsafe([input]: Array<unknown>) { return input; }",
      errors: [error],
    },
    {
      code: "function unsafe([input]: ReadonlyArray<unknown>) { return input; }",
      errors: [error],
    },
    {
      code: "type Inputs = Array<unknown>; function unsafe([input]: Inputs) { return input; }",
      errors: [error],
    },
    {
      code: "function unsafe([, input]: [string, ...unknown[]]) { return input; }",
      errors: [error],
    },
    {
      code: "type Payload = { input: unknown }; function unsafe({ input }: Payload) { return input; }",
      errors: [error],
    },
    {
      code: "interface Payload { input: unknown } function unsafe({ input }: Payload) { return input; }",
      errors: [error],
    },
    {
      code: "type Payload<T> = { input: T }; function unsafe({ input }: Payload<unknown>) { return input; }",
      errors: [error],
    },
    {
      code: "interface Base { input: unknown } interface Payload extends Base {} function unsafe({ input }: Payload) { return input; }",
      errors: [error],
    },
    {
      code: "interface Base<T> { input: T } interface Payload extends Base<unknown> {} function unsafe({ input }: Payload) { return input; }",
      errors: [error],
    },
    {
      code: "interface Payload extends Pick<{ input: unknown; other: string }, 'input'> {} function unsafe({ input }: Payload) { return input; }",
      errors: [error],
    },
    {
      code: "function unsafe({ input }: Record<string, unknown>) { return input; }",
      errors: [error],
    },
    {
      code: "function unsafe({ input }: Record<keyof any, unknown>) { return input; }",
      errors: [error],
    },
    {
      code: "function unsafe({ input }: Record<keyof never, unknown>) { return input; }",
      errors: [error],
    },
    {
      code: "function unsafe({ input }: Record<string & keyof any, unknown>) { return input; }",
      errors: [error],
    },
    {
      code: "function unsafe({ input }: Record<Exclude<string, 'reserved'>, unknown>) { return input; }",
      errors: [error],
    },
    {
      code: "function unsafe({ start }: Record<Exclude<'start' | 'stop', 'stop'>, unknown>) { return start; }",
      errors: [error],
    },
    {
      code: 'function unsafe({ "1": input }: Record<number, unknown>) { return input; }',
      errors: [error],
    },
    {
      code: 'function unsafe({ "key-input": input }: Record<`key-${string}`, unknown>) { return input; }',
      errors: [error],
    },
    {
      code: 'function unsafe({ "id-1": input }: Record<`id-${bigint}`, unknown>) { return input; }',
      errors: [error],
    },
    {
      code: 'function unsafe({ "id-0x10": input }: Record<`id-${bigint}`, unknown>) { return input; }',
      errors: [error],
    },
    {
      code: 'function unsafe({ "id-0b10": input }: Record<`id-${bigint}`, unknown>) { return input; }',
      errors: [error],
    },
    {
      code: 'function unsafe({ "id-0o10": input }: Record<`id-${bigint}`, unknown>) { return input; }',
      errors: [error],
    },
    {
      code: 'function unsafe({ "id-1": input }: Record<`id-${1n}`, unknown>) { return input; }',
      errors: [error],
    },
    {
      code: 'function unsafe({ "id-16": input }: Record<`id-${0x10n}`, unknown>) { return input; }',
      errors: [error],
    },
    {
      code: 'function unsafe({ "id--1": input }: Record<`id-${-1n}`, unknown>) { return input; }',
      errors: [error],
    },
    {
      code: 'function unsafe({ "-1": input }: Record<-1, unknown>) { return input; }',
      errors: [error],
    },
    {
      code: 'function unsafe({ "id--1": input }: Record<`id-${-1}`, unknown>) { return input; }',
      errors: [error],
    },
    {
      code: 'function unsafe({ "+1": input }: Record<`${number}`, unknown>) { return input; }',
      errors: [error],
    },
    {
      code: 'function unsafe({ "01": input }: Record<`${number}`, unknown>) { return input; }',
      errors: [error],
    },
    {
      code: 'function unsafe({ "1.": input }: Record<`${number}`, unknown>) { return input; }',
      errors: [error],
    },
    {
      code: 'function unsafe({ ".5": input }: Record<`${number}`, unknown>) { return input; }',
      errors: [error],
    },
    {
      code: 'function unsafe({ "0x10": input }: Record<`${number}`, unknown>) { return input; }',
      errors: [error],
    },
    {
      code: 'function unsafe({ "0b10": input }: Record<`${number}`, unknown>) { return input; }',
      errors: [error],
    },
    {
      code: 'function unsafe({ "0o10": input }: Record<`${number}`, unknown>) { return input; }',
      errors: [error],
    },
    {
      code: 'function unsafe({ " ": input }: Record<`${number}`, unknown>) { return input; }',
      errors: [error],
    },
    {
      code: 'function unsafe({ "foo-value-bar": input }: Record<`foo-${string}` & `${string}-bar`, unknown>) { return input; }',
      errors: [error],
    },
    {
      code: 'function unsafe({ "flag-true": input }: Record<`flag-${boolean}`, unknown>) { return input; }',
      errors: [error],
    },
    {
      code: 'function unsafe({ "value-null": input }: Record<`value-${null}`, unknown>) { return input; }',
      errors: [error],
    },
    {
      code: 'function unsafe({ "value-undefined": input }: Record<`value-${undefined}`, unknown>) { return input; }',
      errors: [error],
    },
    {
      code: "function unsafe({ NaN: input }: Record<number, unknown>) { return input; }",
      errors: [error],
    },
    {
      code: "function unsafe({ Infinity: input }: Record<number, unknown>) { return input; }",
      errors: [error],
    },
    {
      code: 'function unsafe({ "-Infinity": input }: Record<number, unknown>) { return input; }',
      errors: [error],
    },
    {
      code: 'function unsafe(input: unknown): Record<number, unknown>["NaN"] { return input; }',
      errors: [error],
    },
    {
      code: "function unsafe({ input }: { [key: string]: unknown }) { return input; }",
      errors: [error],
    },
    {
      code: "function unsafe({ input }: Pick<{ input: unknown; other: string }, 'input'>) { return input; }",
      errors: [error],
    },
    {
      code: "function unsafe({ input }: Pick<{ input: unknown }, keyof { input: unknown }>) { return input; }",
      errors: [error],
    },
    {
      code: "interface Keys { input: unknown } function unsafe({ input }: Pick<Keys, keyof Keys>) { return input; }",
      errors: [error],
    },
    {
      code: "interface Base { input: unknown } interface Keys extends Base {} function unsafe({ input }: Pick<Keys, keyof Keys>) { return input; }",
      errors: [error],
    },
    {
      code: 'interface Keys extends Record<"input", unknown> {} function unsafe({ input }: Pick<Keys, keyof Keys>) { return input; }',
      errors: [error],
    },
    {
      code: "function unsafe({ input }: Omit<{ input: unknown; other: string }, 'other'>) { return input; }",
      errors: [error],
    },
    {
      code: 'function unsafe({ reserved }: Omit<Record<string, unknown>, "reserved">) { return reserved; }',
      errors: [error],
    },
    {
      code: "type Selected = Pick<{ input: unknown; other: string }, 'input'>; function unsafe({ input }: Selected) { return input; }",
      errors: [error],
    },
    {
      code: "type InputKey = 'input'; function unsafe({ input }: Pick<{ input: unknown; other: string }, InputKey>) { return input; }",
      errors: [error],
    },
    {
      code: "function unsafe({ input }: { input: unknown } | { input: string }) { return input; }",
      errors: [error],
    },
    {
      code: "function unsafe({ input }: { [Key in 'input']: unknown }) { return input; }",
      errors: [error],
    },
    {
      code: "interface Payload { input: unknown } interface Payload { other: string } function unsafe({ input }: Payload) { return input; }",
      errors: [error],
    },
    {
      code: "namespace Types { export interface Payload { input: unknown } } function unsafe({ input }: Types.Payload) { return input; }",
      errors: [error],
    },
    {
      code: "type Outer = { input: unknown }; namespace Types { export type Payload = Outer; } function unsafe({ input }: Types.Payload) { return input; }",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import type { InheritedUnknownPayload } from './no-known-value-widening-types'; function unsafe({ input }: InheritedUnknownPayload) { return input; }",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import type { UnknownArray } from './no-known-value-widening-types'; function unsafe([input]: UnknownArray) { return input; }",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import type { PickedUnknownPayload } from './no-known-value-widening-types'; function unsafe({ input }: PickedUnknownPayload) { return input; }",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import type { InputKey, UnknownPayload } from './no-known-value-widening-types'; function unsafe({ input }: Pick<UnknownPayload, InputKey>) { return input; }",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import type { UnknownArray } from './no-known-value-widening-types'; function unsafe(input: unknown): UnknownArray[number] { return input; }",
      errors: [error],
    },
    {
      code: "type UnsafeOutput = any; function unsafe(input: unknown): UnsafeOutput { return input; }",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import type { AnyAlias } from './no-known-value-widening-types'; function unsafe(input: unknown): AnyAlias { return input; }",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: "import type { Identity } from './no-known-value-widening-types'; type LocalAny = any; function unsafe(input: unknown): Identity<LocalAny> { return input; }",
      errors: [error],
    },
  ],
});
