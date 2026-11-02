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
      filename: "/repo/scripts/dynamic.ts",
      code: 'const { readFile } = await import("node:fs/promises");',
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
    {
      filename: "/repo/scripts/local-require.ts",
      code: 'function require(name: string) { return name; } require("node:assert");',
    },
    {
      filename: "/repo/scripts/export-other.ts",
      code: 'export { readFile } from "node:fs/promises";',
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
    {
      filename: "/repo/scripts/check.test.mjs",
      code: 'import assert from "node:assert/strict";',
      errors: [error],
    },
    {
      filename: "/repo/scripts/dynamic-assert.ts",
      code: 'const { default: assert } = await import("node:assert/strict");',
      errors: [error],
    },
    {
      filename: "/repo/scripts/dynamic-test.ts",
      code: 'const { test } = await import("bun:test");',
      errors: [error],
    },
    {
      filename: "/repo/scripts/strict.ts",
      code: 'import assert from "assert/strict";',
      errors: [error],
    },
    {
      filename: "/repo/scripts/reexport-test.ts",
      code: 'export { test } from "bun:test";',
      errors: [error],
    },
    {
      filename: "/repo/scripts/reexport-assert.ts",
      code: 'export * from "node:assert";',
      errors: [error],
    },
    {
      filename: "/repo/scripts/require-assert.ts",
      code: 'const assert = require("node:assert/strict");',
      errors: [error],
    },
  ],
});
