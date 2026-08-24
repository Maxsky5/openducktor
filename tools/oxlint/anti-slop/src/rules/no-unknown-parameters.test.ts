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
    "function readText(input: unknown): string | null { return typeof input === 'string' ? input : null; }",
    "function readError(input: unknown): Error | null { if (!(input instanceof Error)) return null; return input; }",
    "function normalizeText(input: unknown): string { const value = typeof input === 'string' ? input : ''; return value.trim(); }",
    "function compare(left: unknown, right: unknown): boolean { if (typeof left !== 'string') return false; if (typeof right !== 'string') return false; return left === right; }",
    "function positiveInteger(input: unknown): number | null | undefined { if (input === undefined || input === null) return input; if (typeof input !== 'number' || !Number.isInteger(input) || input <= 0) throw new Error('invalid'); return input; }",
    "function stringArray(input: unknown): string[] { if (!Array.isArray(input)) throw new HostValidationError({ details: { inputType: runtimeTypeName(input) } }); return input.map(requireString); }",
    "function stringArrayEffect(input: unknown) { if (!Array.isArray(input)) return Effect.fail(new HostValidationError({ details: { inputType: runtimeTypeName(input) } })); return Effect.succeed(input.map(requireString)); }",
    "function readOptions(input: unknown): string[] | null { if (!Array.isArray(input)) return null; const options = []; for (const option of input) options.push(requireString(option)); return options; }",
    "const isLabel = (input: unknown): boolean => typeof input === 'string';",
    "function isUser(input: unknown): input is User { return true; }",
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
      code: "function load(input: unknown): User { const parsed = userSchema.parse(input); return input as User; }",
      errors: [error],
    },
    {
      code: "function load(input: unknown): User { return choose(userSchema.parse(input), input as User); }",
      errors: [error],
    },
    {
      code: "function load(input: unknown): User { if (!isUser(input) && allowRaw) return fallback; return input as User; }",
      errors: [error],
    },
    {
      code: "function parseUser(input: unknown): User { return parseDomainValue(input); }",
      errors: [error],
    },
    {
      code: "function optionalText(input: unknown): string | null | undefined { if (input === undefined || input === null) return input; return requireString(input); }",
      errors: [error],
    },
    {
      code: "function readUser(input: unknown): User | null { if (!isUser(input)) return null; return input; }",
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
    {
      code: "function load(input: unknown) { consume(input); return schema.parse(input); }",
      errors: [error],
    },
    {
      code: "function load(input: unknown) { const parsed = schema.parse(input); consume(input); return parsed; }",
      errors: [error],
    },
    {
      code: "function load(input: unknown) { if (allowRaw) return input; if (typeof input !== 'string') return; return input; }",
      errors: [error],
    },
    {
      code: "function load(input: unknown) { if (typeof input !== 'string') { if (ready) return fallback; log(); } return input; }",
      errors: [error],
    },
    {
      code: "function load(input: unknown) { throw new Error(JSON.stringify(input)); }",
      errors: [error],
    },
    {
      code: "function load(input: unknown) { const parsed = schema.parse(input); switch (mode) { case 'raw': return input; default: return parsed; } }",
      errors: [error],
    },
    {
      code: "function load(input: unknown) { const parsed = schema.parse(input); return input(); }",
      errors: [error],
    },
  ],
});
