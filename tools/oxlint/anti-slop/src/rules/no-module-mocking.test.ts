import { RuleTester } from "oxlint/plugins-dev";

import { noModuleMockingRule } from "./no-module-mocking.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "moduleMock" };

tester.run("anti-slop/no-module-mocking", noModuleMockingRule, {
  valid: [
    "const store = new InMemoryUserStore();",
    "vi.spyOn(store, 'save');",
    "const vi = { mock() {} }; vi.mock();",
    "function test(jest: { mock(): void }) { jest.mock(); }",
    "import { vi as localVi } from './helpers'; localVi.mock('./module');",
    "import * as vitest from './helpers'; vitest.vi.mock('./module');",
    "const vitest = { vi: { mock() {} } }; vitest.vi.mock('./module');",
    "let moduleMock = vi.mock; moduleMock = localMock; moduleMock('./module');",
  ],
  invalid: [
    { code: "vi.mock('./user-store');", errors: [error] },
    { code: "jest.mock('./user-store');", errors: [error] },
    { code: "vi['doMock']('./user-store');", errors: [error] },
    { code: "jest.unstable_mockModule('./user-store');", errors: [error] },
    { code: "globalThis.jest.mock('./user-store');", errors: [error] },
    { code: "import { vi } from 'vitest'; vi.mock('./user-store');", errors: [error] },
    {
      code: "import { vi as testApi } from 'vitest'; testApi.mock('./user-store');",
      errors: [error],
    },
    {
      code: "import { jest } from '@jest/globals'; jest.mock('./user-store');",
      errors: [error],
    },
    {
      code: "import * as vitest from 'vitest'; vitest.vi.mock('./user-store');",
      errors: [error],
    },
    {
      code: "import * as globals from '@jest/globals'; globals.jest.mock('./user-store');",
      errors: [error],
    },
    {
      code: "import { mock } from 'bun:test'; mock.module('./user-store', () => ({}));",
      errors: [error],
    },
    {
      code: "import { mock as bunMock } from 'bun:test'; bunMock.module('./user-store', () => ({}));",
      errors: [error],
    },
    {
      code: "import * as bunTest from 'bun:test'; bunTest.mock.module('./user-store', () => ({}));",
      errors: [error],
    },
    {
      code: "import { mock } from 'bun:test'; mock['module']('./user-store', () => ({}));",
      errors: [error],
    },
    { code: "const moduleMock = vi.mock; moduleMock('./user-store');", errors: [error] },
    { code: "const { mock: moduleMock } = vi; moduleMock('./user-store');", errors: [error] },
  ],
});
