import { expect, jest, test } from "bun:test";
import { Effect } from "effect";
import { loadClaudeRuntimeCatalog } from "../claude/claude-agent-sdk-catalog";
import { createClaudeQueryFixture } from "../claude/claude-agent-sdk-session-io.test-support";
import { fromPromise, INIT_TIMEOUT_MS } from "../claude/claude-agent-sdk-utils";
import { unexpectedRuntimeQueries } from "../../test-support/runtime-query-test-doubles";
import { createClaudeRuntimeQueryAdapter } from "./runtime-query-adapter";

const catalogInput = {
  repoPath: "/repo",
  runtimeKind: "claude",
  workingDirectory: "/repo",
} as const;

for (const method of ["loadRuntimeCatalog"] as const) {
  test(`${method} passes a combined Claude catalog through the wrapper`, async () => {
    const adapter = createClaudeRuntimeQueryAdapter({
      ...unexpectedRuntimeQueries,
      [method]: () =>
        Effect.succeed({
          models: { status: "available", catalog: { models: [], defaultModelsByProvider: {} } },
        }),
    });
    expect(await Effect.runPromise(adapter[method](catalogInput))).toEqual({
      models: { status: "available", catalog: { models: [], defaultModelsByProvider: {} } },
    });
  });

  test(`${method} keeps connection details inside the host`, async () => {
    const adapter = createClaudeRuntimeQueryAdapter({
      ...unexpectedRuntimeQueries,
      [method]: () =>
        fromPromise("claudeRuntime.loadRuntimeCatalog", async () => {
          throw new Error("secret http://127.0.0.1:9999");
        }),
    });
    const failure = await Effect.runPromise(Effect.flip(adapter[method](catalogInput)));
    expect(failure.failure.code).toBe("request_failed");
    expect(JSON.stringify(failure.failure)).not.toContain("secret");
    expect(JSON.stringify(failure.failure)).not.toContain("127.0.0.1");
  });
}

test("a catalog timeout reaches the client with its own message", async () => {
  const sdkQuery = createClaudeQueryFixture({
    initializationResult: () => new Promise(() => {}),
  });
  const adapter = createClaudeRuntimeQueryAdapter({
    ...unexpectedRuntimeQueries,
    loadRuntimeCatalog: (input) =>
      fromPromise("claudeRuntime.loadRuntimeCatalog", () =>
        loadClaudeRuntimeCatalog(input, undefined, process.execPath, () => sdkQuery),
      ),
  });

  jest.useFakeTimers();
  try {
    const result = Effect.runPromise(Effect.flip(adapter.loadRuntimeCatalog(catalogInput)));
    jest.advanceTimersByTime(INIT_TIMEOUT_MS);
    const failure = await result;

    const message =
      "Claude Agent SDK catalog initialization timed out. Check Claude authentication and network connectivity.";
    expect(failure.message).toBe(message);
    expect(failure.failure).toMatchObject({ code: "request_failed", detail: message });
  } finally {
    jest.useRealTimers();
  }
});
