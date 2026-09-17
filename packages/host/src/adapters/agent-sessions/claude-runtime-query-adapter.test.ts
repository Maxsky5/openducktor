import { expect, test } from "bun:test";
import { Effect } from "effect";
import { fromPromise } from "../claude/claude-agent-sdk-utils";
import { unexpectedRuntimeQueries } from "../../test-support/runtime-query-test-doubles";
import { createClaudeRuntimeQueryAdapter } from "./claude-runtime-query-adapter";

const catalogInput = {
  repoPath: "/repo",
  runtimeKind: "claude",
  workingDirectory: "/repo",
} as const;

test("passes a combined Claude catalog through the wrapper", async () => {
  const adapter = createClaudeRuntimeQueryAdapter({
    ...unexpectedRuntimeQueries,
    loadRuntimeCatalog: () =>
      Effect.succeed({
        models: { status: "available", catalog: { models: [], defaultModelsByProvider: {} } },
      }),
  });
  expect(await Effect.runPromise(adapter.loadRuntimeCatalog(catalogInput))).toEqual({
    models: { status: "available", catalog: { models: [], defaultModelsByProvider: {} } },
  });
});

test("unknown wrapped Claude failures keep connection details inside the host", async () => {
  const adapter = createClaudeRuntimeQueryAdapter({
    ...unexpectedRuntimeQueries,
    loadRuntimeCatalog: () =>
      fromPromise("claudeRuntime.loadRuntimeCatalog", async () => {
        throw new Error("secret http://127.0.0.1:9999");
      }),
  });
  const failure = await Effect.runPromise(Effect.flip(adapter.loadRuntimeCatalog(catalogInput)));
  expect(failure.failure.code).toBe("request_failed");
  expect(JSON.stringify(failure.failure)).not.toContain("secret");
  expect(JSON.stringify(failure.failure)).not.toContain("127.0.0.1");
});
