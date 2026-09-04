# Testing guide

Read this guide before you add or change tests.

## Coverage

- Test each changed behavior in its owning package.
- Add deep tests for changed behavior in `packages/host`, `packages/core`, adapters, and MCP.
- Add frontend tests for changed frontend behavior.
- Do not change a production API, constructor, option, or exported type only to make a test easier or faster.
- Use a narrow test helper, a local fake around an existing boundary, or a production refactor that improves the design.

## Bun module mocks

- Prefer dependency injection, a direct function parameter, or `spyOn` to `mock.module(...)`.
- Mock the source module that owns an export. Do not mock a shared barrel such as `@/state`, `@/components`, or another `index.ts` module.
- Match the exact import string used by production code.
- Scope `mock.module(...)` to the smallest test span.
- Restore the exact module ID to a captured real module or a source path that the mock does not replace.
- Do not load the real module through the mocked specifier while the mock is active.
- Do not use process-wide `mock.restore()` to clean up `mock.module(...)`.
- Do not leave a module mock active after its test scope.

Bun can interleave test files in one process. A file-wide module mock or process-wide restore can change another test.

## Test isolation

- Prefer a focused hook or module test to a broad page test for orchestration or routing behavior.
- Use an injected fake when a test only checks one dependency input.
- Do not mutate `host`, a shared query client, an exported adapter, or another module singleton when a local seam can replace it.
- Restore an unavoidable singleton mutation in `finally` or `afterEach`.
- Give each TanStack Query test its own query client through `QueryProvider` with `useIsolatedClient`.
- Provide the smallest required context providers for hooks and components.
- Give each fixture new nested objects and arrays.

A `renderToStaticMarkup` test needs the same Query and context providers as a client-rendered test.

## Async and flaky tests

- Use an explicit `waitFor(...)` or test-harness timeout for async Query, portal, or render work.
- Keep each explicit wait below the Bun test timeout.
- Run flake checks in sequence.

## Browser validation

- Use `agent-browser` against the live app and the real OpenDucktor backend.
- Use browser mode when it can cover the UI change.
- Ask the user to start `bun run browser:dev`.
- Connect to the running app. Do not start the browser runner yourself.
