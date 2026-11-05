# Testing guide

Read this guide before you change behavior or tests.

## Coverage

- Test each changed behavior in its owning package.
- Add deep tests for changed behavior in `packages/host`, `packages/core`, adapters, and MCP.
- Add frontend tests for changed frontend behavior.
- When host code reads a task workflow, also test it with `createReviewTaskWorkflow` from `@openducktor/workflows/test-support`. Its IDs differ from the built-in IDs, so the test fails when host code depends on a built-in name.
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
- Give each TanStack Query test its own query client through `QueryProvider` from `@/test-utils/query-provider`, which creates a test client connection.
- Supply host fakes with `createTestClientConnection({ client: { ... } })` from `@openducktor/frontend-core/test-support/test-client-connection`. Do not mutate a shared host client.
- Pass `scheduleTask: () => () => {}` to `createTestClientConnection` to stop automatic draft writes. The test then calls `flush()` itself.
- Frontend stores that keep host state read `ClientConnection` storage. Seed or check that state through `createTestClientConnection({ storage })`.
- Provide the smallest required context providers for hooks and components.
- Give each fixture new nested objects and arrays.

A `renderToStaticMarkup` test that uses Query or app context needs the same providers as a client-rendered test.

Use [withViteTestServer](../packages/openducktor-web/src/vite-test-server.ts) for Vite server tests in the web package. It gives each server a temporary cache and closes the server before cleanup. A test server must not share the running app's cache. Vite can delete that cache when the test uses different dependency settings.

## Mobile tests

- `apps/mobile` runs `bun test --parallel`. React Native components do not load under Bun, so test the logic in modules and hooks without React Native imports.
- Inject native modules through their interfaces, such as the network module of `src/platform/native-remote-transport.ts`. Do not mock modules.
- Use `apps/mobile/src/test-support/simulated-remote-host.ts` for flows that need a remote host: discovery, negotiation, the host channel, refusals, unreachable hosts, and release. Add a helper to it when a mobile test needs more host behavior.
- `packages/openducktor-web/src/mobile-host-session.integration.test.ts` starts a real TypeScript host with Remote control on and connects the mobile host session owner to it. Run it through the package `test` script, so the test preload gives the host a temporary config directory.
- The `Checks` jobs of `ci.yml` bundle the JavaScript of the app with `expo export` on Linux, macOS, and Windows. They read and write the Metro transform cache through `EXPO_METRO_CACHE_RESTORE_DIR` and `EXPO_METRO_CACHE_OUTPUT_DIR`. Only pushes to `main` save that cache.
- The native CI jobs run only when a change reaches a native input that the `mobile-changes` job of `ci.yml` lists. On a pull request, `Mobile Native Projects` runs `expo prebuild` for both platforms, which runs the config plugins. After a merge to `main` and on each manual run, `Mobile iOS Build` and `Mobile Android Build` compile Debug builds of the iOS app for the simulator and of the Android app, for `arm64` only.
- Check native behavior, gestures, layout, and performance on real iOS and Android devices with release builds against a real host. See [Device validation](../apps/mobile/README.md#device-validation).

## Parallel runs

- [test-shard.ts](../scripts/test-shard.ts) runs every workspace suite and the root script suite in sequence with `bun test --shard`, so it runs a part of the files of each suite. A suite with another test runner, such as the Node runner of the oxlint rules, runs all its files in the first shard. It runs every suite before it reports the failed ones.
- The root `bun run test` runs the only shard, `1/1`. CI splits the tests of each platform into shards. The matrix of each `Tests` job in `ci.yml` sets the shard count. macOS has fewer shards, because GitHub runs at most five macOS jobs of the repository at the same time.
- The `TypeScript Workspace Quality` job of a platform is its required check. It runs also when a run is cancelled, and it passes only when the `Checks`, `Build`, and `Tests` jobs of that platform pass.
- On Windows, CI puts `TMP` and `TEMP` on the `D:` drive, because temp trees there are faster than on `C:`.
- `packages/frontend` and `packages/host` run with `bun test --parallel --no-isolate`.
- `packages/frontend-core` runs with `bun test --parallel`, so each file has its own global. Its tests run without DOM globals. A test file that renders React or reads browser APIs imports `test-support/dom-environment` first. Keep pure tests without it, so they prove that the package runs without a DOM.
- The host suite uses two workers to limit process load on Windows CI.
- The host worker bundle test runs under Node, Bun, and Electron. It uses the Electron runtime from `apps/electron` and downloads it on first use when it is missing. The `Tests` jobs install that runtime before the suite.
- The SQLite task-store test helper uses disposable files with WAL and foreign keys. It disables synchronous disk flushes before running production migrations. Tests that check production connection setup use `openHostDatabaseConnection` directly.
- `packages/openducktor-mcp` runs with `bun test --parallel`, so each test file gets an isolated worker process.
- The other workspaces run serially in one process.
- The preload gives every parallel worker its own temp directory and config directory.
- The preload removes the document theme class after each frontend test file.
- Keep the workspace test timeouts: the host suite uses 5000 ms and the other workspaces use 1000 ms.
- Fix a slow test at the source. Do not raise a timeout to hide it.
- Give a single test an explicit per-test timeout only when its own work is heavy, such as a real process spawn or a full render flow. Name the cause in a comment above the timeout.

## Async and flaky tests

- Use an explicit `waitFor(...)` or test-harness timeout for async Query, portal, or render work.
- Keep each explicit wait below the Bun test timeout.
- Await a hook harness call or another `act()` flow directly. Do not wrap it in `expect(...).resolves`, because Bun can then delay the end of `act()` by hundreds of milliseconds.
- Await a Promise that waits for a timer before you assert its result. Do not use `expect(promise).rejects` or `.resolves` for it: on Windows, Bun can stop timers while the matcher waits, and the test hangs.
- Run flake checks in sequence.
- Load each module of a test file when the file loads. A dynamic `import()` in a test body, or the first render of a `React.lazy` component, counts against the time limit of that test. Its time depends on the files that ran before it in the same worker, so it changes with the CI shard. Load a lazy module with a top-level `await import(...)`.
- Bun starts the next test while the body of a timed-out test continues to run. The late steps of that body can overlap the `act()` calls of the next test and remove its spies and globals.
- A harness or test wrapper that installs spies, globals, or a rendered tree must wait in `onTestFinished` until the test body ends, and then remove them. Use [restoreAfterTestBody](../packages/frontend/src/test-utils/restore-after-test-body.ts) for this. An `afterEach` hook cannot wait for the body.
- [createDialogPreviewHarness](../packages/frontend/src/components/features/agents/agent-chat/agent-session-dialog-preview-test-harness.tsx) shows this pattern for a harness, and `previewTest` in [task-execution-file-preview.test.tsx](../packages/frontend/src/components/features/agents/task-execution-file-preview.test.tsx) shows it for a test wrapper.

## Browser validation

- Use `agent-browser` against the live app and the real OpenDucktor backend.
- Use browser mode when it can cover the UI change.
- Ask the user to start `bun run browser:dev`.
- Connect to the running app. Do not start the browser runner yourself.

The HTML artifact test needs an installed Chromium 152 or later. Set `ODT_ARTIFACT_PREVIEW_CHROME` to its executable to run the opt-in test. It starts headless Chrome with a temporary profile and tests the real bootstrap response, fragment navigation, and isolation. Without this variable, the normal test suite skips it.

```sh
ODT_ARTIFACT_PREVIEW_CHROME="/path/to/chrome" \
  bun run --filter @openducktor/remote-host test src/artifact-preview-bootstrap.live.test.ts
```
