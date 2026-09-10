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
const handlers = createAgentRuntimeQueryCommandHandlers({
  ...unexpectedRuntimeQueries,
  listAvailableModels: () => Effect.succeed({ models: [], defaultModelsByProvider: {} }),
});

for (const invalid of [
  undefined,
  {},
  { input: { ...input, endpoint: "http://127.0.0.1:7777" } },
  { input, runtimeId: "client-selected" },
  { input: { ...input, runtimeKind: "other" } },
]) {
  test(`rejects invalid query envelope ${JSON.stringify(invalid)}`, async () => {
    const error = await Effect.runPromise(Effect.flip(handlers.agent_runtime_list_models(invalid)));
    expect(hostInvokeFailureFromError(error)).toMatchObject({
      kind: "runtime_query",
      runtimeQueryFailure: { code: "invalid_input", operation: "agent_runtime_list_models" },
    });
  });
}

test("returns normalized catalog data through the shared command", async () => {
  expect(await Effect.runPromise(handlers.agent_runtime_list_models({ input }))).toEqual({
    models: [],
    defaultModelsByProvider: {},
  });
});

test("rejects a catalog describing the wrong runtime", async () => {
  const handlers = createAgentRuntimeQueryCommandHandlers({
    ...unexpectedRuntimeQueries,
    // SAFETY: Deliberately malformed native data exercises host response validation.
    listAvailableModels: () =>
      Effect.succeed({
        runtime: OPENCODE_RUNTIME_DESCRIPTOR,
        models: [],
        defaultModelsByProvider: {},
      }),
  });
  const error = await Effect.runPromise(
    Effect.flip(handlers.agent_runtime_list_models({ input: { ...input, runtimeKind: "codex" } })),
  );
  expect(error.failure.code).toBe("invalid_runtime_response");
});

test("fails a malformed catalog without affecting other catalog commands", async () => {
  const handlers = createAgentRuntimeQueryCommandHandlers({
    ...unexpectedRuntimeQueries,
    // SAFETY: Deliberately malformed native data exercises host response validation.
    listAvailableModels: () =>
      Effect.succeed({ models: [{ id: "broken" }], defaultModelsByProvider: {} } as never),
    listAvailableSkills: () => Effect.succeed({ skills: [] }),
  });
  expect(
    (await Effect.runPromise(Effect.flip(handlers.agent_runtime_list_models({ input })))).failure
      .code,
  ).toBe("invalid_runtime_response");
  expect(
    await Effect.runPromise(
      handlers.agent_runtime_list_skills({ input: { ...input, workingDirectory: "/remote/repo" } }),
    ),
  ).toEqual({ skills: [] });
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
      listAvailableModels: async () => {
        throw cause;
      },
    });
    const error = await Effect.runPromise(Effect.flip(queries.listAvailableModels(input)));
    const wire = hostInvokeFailureFromError(error);
    expect(wire).toMatchObject({
      kind: "runtime_query",
      runtimeQueryFailure: { code, repoPath: input.repoPath, runtimeKind: input.runtimeKind },
    });
    expect(JSON.stringify(wire)).not.toContain("127.0.0.1");
    expect(JSON.stringify(wire)).not.toContain("secret");
  }
});

test("exposes only the nine normalized query commands", () => {
  expect(Object.keys(handlers).sort()).toEqual(
    Object.values(AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS)
      .map((contract) => contract.command)
      .sort(),
  );
});
