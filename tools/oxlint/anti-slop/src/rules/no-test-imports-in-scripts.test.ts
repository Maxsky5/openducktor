import { RuleTester } from "oxlint/plugins-dev";

import { noTestImportsInScriptsRule } from "./no-test-imports-in-scripts.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "testImport" };

tester.run("anti-slop/no-test-imports-in-scripts", noTestImportsInScriptsRule, {
  valid: [
    {
      filename: "/repo/scripts/build.ts",
      code: 'import { readFile } from "node:fs/promises";',
    },
    {
      filename: "/repo/scripts/build.test.ts",
      code: 'import { expect, test } from "bun:test";',
    },
    {
      filename: "/repo/scripts/check.test.mjs",
      code: 'import assert from "node:assert/strict";',
    },
    {
      filename: "/repo/src/check.ts",
      code: 'import assert from "node:assert/strict";',
    },
    {
      filename: "/repo/tools/scripts-helper/check.ts",
      code: 'import assert from "node:assert";',
    },
    {
      filename: "/repo/apps/electron/scripts/build.ts",
      code: 'import { describe } from "node:test";',
    },
  ],
  invalid: [
    {
      filename: "/repo/scripts/check.mjs",
      code: 'import assert from "node:assert/strict";',
      errors: [error],
    },
    {
      filename: "/repo/scripts/measure.ts",
      code: 'import { expect, test } from "bun:test";',
      errors: [error],
    },
    {
      filename: "/repo/scripts/deep/check.ts",
      code: 'import assert from "assert";',
      errors: [error],
    },
    {
      filename: "C:\\repo\\scripts\\check.ts",
      code: 'import assert from "node:assert";',
      errors: [error],
    },
    {
      filename: "/repo/apps/electron/scripts/build.ts",
      code: 'import { deepEqual } from "node:assert";',
      errors: [error],
    },
  ],
});
