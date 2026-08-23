import { RuleTester } from "oxlint/plugins-dev";

import { noUnknownParametersRule } from "./no-unknown-parameters.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "unknownParameter" };

tester.run("anti-slop/no-unknown-parameters", noUnknownParametersRule, {
  valid: [
    "function load(input: User) { return input; }",
    "const fail = (cause: unknown) => cause;",
    "function isUser(input: unknown): input is User { return userSchema.safeParse(input).success; }",
    "function parseUser(input: unknown) { return userSchema.parse(input); }",
    "function normalizeUser(input: unknown) { return normalize(userSchema.parse(input)); }",
    "function parseUser(input: unknown): User { return useCache ? cachedUserSchema.parse(input) : userSchema.parse(input); }",
    "function requireUser(input: unknown): User { const record = requireRecord(input); return userSchema.parse(record); }",
    "function readRecord(input: unknown): Record<string, unknown> | undefined { const record = asUnknownRecord(input); return record; }",
    "function readName(input: unknown): string | null { if (!isPlainObject(input)) return null; return typeof input.name === 'string' ? input.name : null; }",
    "function readObject(input: unknown) { if (!isPlainObject(input)) return null; return input.name; }",
    "function readText(input: unknown): string | null { return typeof input === 'string' ? input : null; }",
    "function readError(input: unknown): Error | null { if (!(input instanceof Error)) return null; return input; }",
    "function normalizeText(input: unknown): string { const value = typeof input === 'string' ? input : ''; return value.trim(); }",
    "function compare(left: unknown, right: unknown): boolean { if (typeof left !== 'string') return false; if (typeof right !== 'string') return false; return left === right; }",
    "const isLabel = (input: unknown): boolean => typeof input === 'string';",
    "function readWith(guard: (input: unknown) => input is User) { return guard(source); }",
    "type Loader = (input: string) => void;",
    "function load(...parts: string[]) { return parts.join(''); }",
    "function logValues(...parts: unknown[]) { console.log(...parts); }",
  ],
  invalid: [
    { code: "function load(input: unknown) { return input; }", errors: [error] },
    { code: "const load = (input: unknown = source) => input;", errors: [error] },
    { code: "type Loader = (input: unknown) => void;", errors: [error] },
    {
      code: "function load(input: Parameters<typeof schema.parse>[0]) { return input; }",
      errors: [error],
    },
    {
      code: "function load(input: unknown) { parseInt(input); return input; }",
      errors: [error],
    },
    {
      code: "function load(input: unknown) { return parseUser(input).user; }",
      errors: [error],
    },
    {
      code: "function load(input: unknown) { return useCache ? parseInt(input) : input; }",
      errors: [error],
    },
    {
      code: "function load(input: unknown) { userSchema.parse(input); return input; }",
      errors: [error],
    },
    {
      code: "function load(input: unknown) { const parsed = userSchema.parse(input); return input; }",
      errors: [error],
    },
    {
      code: "function load(input: unknown) { if (input === input) return input; }",
      errors: [error],
    },
    {
      code: "function load(input: unknown) { if (typeof input === 'string') log(input); return input; }",
      errors: [error],
    },
    {
      code: "function load(input: unknown) { if (isUser(input)) log(input); return input; }",
      errors: [error],
    },
    {
      code: "function load(input: unknown) { if (input === null) return null; return input; }",
      errors: [error],
    },
  ],
});
