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
  ],
  invalid: [
    { code: "function load(input: unknown) { return input; }", errors: [error] },
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
      code: "function unsafe({ input }: Record<string, unknown>) { return input; }",
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
      code: "type Selected = Pick<{ input: unknown; other: string }, 'input'>; function unsafe({ input }: Selected) { return input; }",
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
      code: "type UnsafeOutput = any; function unsafe(input: unknown): UnsafeOutput { return input; }",
      errors: [error],
    },
  ],
});
