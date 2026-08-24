import { RuleTester } from "oxlint/plugins-dev";

import { requireSafetyCommentForTypeAssertionRule } from "./require-safety-comment-for-type-assertion.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "missingSafetyComment" };

tester.run(
  "anti-slop/require-safety-comment-for-type-assertion",
  requireSafetyCommentForTypeAssertionRule,
  {
    valid: [
      "const values = [1, 2] as const;",
      "const value = <const>{ id: 'one' };",
      "// SAFETY: The parser established the UserId invariant.\nconst id = value as UserId;",
      "function parse(): UserId {\n// SAFETY: Validation above established the UserId invariant.\nreturn value as UserId;\n}",
      "const id = /* SAFETY: Validation established the invariant. */ value as UserId;",
      "// SAFETY: The parser established the UserId invariant.\nexport const id = value as UserId;",
      "expect(error).toBeInstanceOf(Error);\n// SAFETY: The preceding assertion proves that error is an Error.\nconst failure = error as Error;",
      "if (!(value instanceof UserId)) throw new Error('invalid');\n// SAFETY: The preceding guard proves that value is a UserId.\nconst id = value as UserId;",
    ],
    invalid: [
      { code: "const id = value as UserId;", errors: [error] },
      { code: "const id = <UserId>value;", errors: [error] },
      { code: "const id = value as UserId; // SAFETY: Too late.", errors: [error] },
      {
        code: "// This cast seems fine.\nconst id = value as UserId;",
        errors: [error],
      },
      {
        code: "// SAFETY: This test controls the fixture and supplies UserId.\nconst id = value as UserId;",
        errors: [error],
      },
      {
        code: "// SAFETY: This test creates the DOM fixture before this lookup.\nconst button = value as HTMLButtonElement;",
        errors: [error],
      },
      {
        code: "// SAFETY: This test drives the failure path before this assertion.\nconst failure = value as Error;",
        errors: [error],
      },
      {
        code: "// SAFETY: Both values were validated.\nconst pair = { left: first as UserId, right: second as RoleId };",
        errors: [error, error],
      },
      {
        code: "// SAFETY: Both values were validated.\nconst pair = { left: first as UserId, right: second as UserId };",
        errors: [error, error],
      },
      {
        code: "expect(value).not.toBeNull();\nconst id = value as UserId;",
        errors: [error],
      },
      {
        code: "const text = 'expect(value).toBeInstanceOf(UserId)';\nconst id = value as UserId;",
        errors: [error],
      },
    ],
  },
);
