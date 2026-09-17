import { expect, test } from "bun:test";
import {
  AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS,
  OPENCODE_RUNTIME_DESCRIPTOR,
} from "@openducktor/contracts";
import { AgentRuntimeQueryError } from "@openducktor/core";
import { Effect } from "effect";
import { createRuntimeQueryAdapter } from "../../adapters/agent-sessions/runtime-query-adapter";
import {
  unexpectedNativeRuntimeQueries,
  unexpectedRuntimeQueries,
} from "../../test-support/runtime-query-test-doubles";
import { hostInvokeFailureFromError } from "../router/host-invoke-failure";
import { createAgentRuntimeQueryCommandHandlers } from "./agent-runtime-query-command-handlers";

const input = { repoPath: "/remote/repo", runtimeKind: "opencode" } as const;
const directoryInput = { ...input, workingDirectory: "/remote/repo" } as const;
const modelsCatalog = {
  models: [],
  defaultModelsByProvider: {},
};
const handlers = createAgentRuntimeQueryCommandHandlers({
  ...unexpectedRuntimeQueries,
  loadRuntimeCatalog: () =>
    Effect.succeed({ models: { status: "available" as const, catalog: modelsCatalog } }),
});

for (const invalid of [
  undefined,
  {},
  { input: { ...directoryInput, endpoint: "http://127.0.0.1:7777" } },
  { input: directoryInput, runtimeId: "client-selected" },
  { input: { ...directoryInput, runtimeKind: "other" } },
]) {
  test(`rejects invalid query envelope ${JSON.stringify(invalid)}`, async () => {
    const error = await Effect.runPromise(
      Effect.flip(handlers.agent_runtime_load_catalog(invalid)),
    );
    expect(hostInvokeFailureFromError(error)).toMatchObject({
      kind: "runtime_query",
      runtimeQueryFailure: { code: "invalid_input", operation: "agent_runtime_load_catalog" },
    });
  });
}

test("returns the combined catalog through the shared command", async () => {
  expect(
    await Effect.runPromise(handlers.agent_runtime_load_catalog({ input: directoryInput })),
  ).toEqual({
    models: { status: "available", catalog: modelsCatalog },
  });
});

test("rejects a catalog describing the wrong runtime", async () => {
  const handlers = createAgentRuntimeQueryCommandHandlers({
    ...unexpectedRuntimeQueries,
    loadRuntimeCatalog: () =>
      Effect.succeed({
        runtime: OPENCODE_RUNTIME_DESCRIPTOR,
        models: { status: "available" as const, catalog: modelsCatalog },
      }),
  });
  const error = await Effect.runPromise(
    Effect.flip(
      handlers.agent_runtime_load_catalog({
        input: { ...directoryInput, runtimeKind: "codex" },
      }),
    ),
  );
  expect(error.failure.code).toBe("invalid_runtime_response");
});

test("rejects a malformed combined catalog response", async () => {
  const handlers = createAgentRuntimeQueryCommandHandlers({
    ...unexpectedRuntimeQueries,
    // SAFETY: Invalid catalog data tests host response checks.
    loadRuntimeCatalog: () =>
      Effect.succeed({
        models: { status: "available", catalog: { models: [{ id: "broken" }] } },
      } as never),
  });
  expect(
    (
      await Effect.runPromise(
        Effect.flip(handlers.agent_runtime_load_catalog({ input: directoryInput })),
      )
    ).failure.code,
  ).toBe("invalid_runtime_response");
});

test("preserves actionable native query failures without leaking native connection details", async () => {
  for (const [cause, code] of [
    [new Error("connect http://127.0.0.1:7777?token=secret"), "request_failed"],
    [
      new AgentRuntimeQueryError("scope_mismatch", "Select the matching directory."),
      "scope_mismatch",
    ],
  ] as const) {
    const queries = createRuntimeQueryAdapter({
      ...unexpectedNativeRuntimeQueries,
      loadRuntimeCatalog: async () => {
        throw cause;
      },
    });
    const error = await Effect.runPromise(Effect.flip(queries.loadRuntimeCatalog(directoryInput)));
    const wire = hostInvokeFailureFromError(error);
    expect(wire).toMatchObject({
      kind: "runtime_query",
      runtimeQueryFailure: { code, repoPath: input.repoPath, runtimeKind: input.runtimeKind },
    });
    expect(JSON.stringify(wire)).not.toContain("127.0.0.1");
    expect(JSON.stringify(wire)).not.toContain("secret");
  }
});

test("exposes only the normalized query commands", () => {
  expect(Object.keys(handlers).sort()).toEqual(
    Object.values(AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS)
      .map((contract) => contract.command)
      .sort(),
  );
});
