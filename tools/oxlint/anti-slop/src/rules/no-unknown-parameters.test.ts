import { RuleTester } from "oxlint/plugins-dev";

import { noUnknownParametersRule } from "./no-unknown-parameters.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "unknownParameter" };

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
  ],
  invalid: [
    { code: "function load(input: unknown) { return input; }", errors: [error] },
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
      code: "type UnsafeOutput = any; function unsafe(input: unknown): UnsafeOutput { return input; }",
      errors: [error],
    },
  ],
});
