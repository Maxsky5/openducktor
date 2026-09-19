import { expect, mock, test } from "bun:test";
import { AgentRuntimeQueryError } from "@openducktor/core";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { CodexSessionHistoryError } from "../../ports/codex-session-history-error";
import { createCodexRuntimeTransport } from "./codex-runtime-transport";
import { toRuntimeQueryError } from "./runtime-query-adapter";
import { createCodexAppServerTransportRegistry } from "../codex/codex-app-server-transport-registry";
import { hostInvokeFailureFromError } from "../../interface/router/host-invoke-failure";

const createTransportWithRequest = (
  request: Parameters<typeof createCodexRuntimeTransport>[0]["request"],
) =>
  createCodexRuntimeTransport(
    {
      request,
      listLoadedThreads: () => Effect.dieMessage("Unexpected listLoadedThreads"),
      listThreads: () => Effect.dieMessage("Unexpected listThreads"),
      respond: () => Effect.dieMessage("Unexpected respond"),
      listThreadTurns: () => Effect.dieMessage("Unexpected listThreadTurns"),
    },
    "private-runtime",
  );

test("an actual missing-transport failure keeps native identity inside the host", async () => {
  const registry = createCodexAppServerTransportRegistry();
  const error = await Effect.runPromise(
    Effect.flip(
      registry.listThreadTurns({
        runtimeId: "private-runtime-repro",
        threadId: "thread-1",
      }),
    ),
  );
  expect(error.failure.detail).toContain("private-runtime-repro");
  const failure = hostInvokeFailureFromError(
    toRuntimeQueryError(
      "load session history",
      { repoPath: "/repo", runtimeKind: "codex", externalSessionId: "thread-1" },
      error,
    ),
  );
  expect(failure).toMatchObject({
    kind: "runtime_query",
    runtimeQueryFailure: {
      code: "request_failed",
      sessionHistoryFailure: {
        diagnosticId: error.failure.diagnosticId,
        method: "thread/turns/list",
      },
    },
  });
  expect(JSON.stringify(failure)).not.toContain("private-runtime-repro");
});

test("host-native Codex queries preserve paged history diagnostics", async () => {
  const failure = {
    code: "invalid_runtime_response" as const,
    summary: "Codex returned invalid conversation history.",
    detail: "Native runtime private-runtime at http://127.0.0.1:9999 failed with token=secret.",
    diagnosticId: "diagnostic-1",
    method: "thread/turns/list" as const,
    pageCursor: "page-2",
  };
  const error = new CodexSessionHistoryError({
    message: failure.summary,
    failure,
    runtimeId: "private-runtime",
    threadId: "thread-1",
  });
  const listThreadTurns = mock(() => Effect.fail(error));
  const transport = createCodexRuntimeTransport(
    {
      request: () => Effect.dieMessage("Unexpected raw request"),
      listLoadedThreads: () => Effect.dieMessage("Unexpected listLoadedThreads"),
      listThreads: () => Effect.dieMessage("Unexpected listThreads"),
      respond: () => Effect.dieMessage("Unexpected respond"),
      listThreadTurns,
    },
    "private-runtime",
  );
  const request = {
    method: "thread/turns/list" as const,
    params: { threadId: "thread-1", cursor: "page-2" },
  };
  await expect(transport.request(request)).rejects.toBe(error);
  expect(listThreadTurns).toHaveBeenCalledWith({ runtimeId: "private-runtime", ...request.params });
  const queryError = toRuntimeQueryError(
    "load session history",
    { repoPath: "/repo", runtimeKind: "codex", externalSessionId: "thread-1" },
    error,
  );
  expect(queryError.failure.sessionHistoryFailure).toMatchObject({
    code: failure.code,
    method: failure.method,
    diagnosticId: failure.diagnosticId,
    pageCursor: failure.pageCursor,
  });
  expect(JSON.stringify(queryError.failure)).not.toContain("private-runtime");
  expect(JSON.stringify(queryError.failure)).not.toContain("127.0.0.1");
  expect(JSON.stringify(queryError.failure)).not.toContain("secret");
  expect(queryError.cause).toBe(error);
});

test("reports a dead Codex transport as an unreachable runtime", async () => {
  const transportLoss = new HostOperationError({
    operation: "codexAppServerTransport.request.model/list",
    message: "Codex app-server request model/list failed for runtime private-runtime",
    cause: new HostOperationError({
      operation: "codexAppServerTransport.childProcess",
      message: "Codex app-server closed for runtime private-runtime",
    }),
  });
  const transport = createTransportWithRequest(() => Effect.fail(transportLoss));

  const error = await transport
    .request({ method: "model/list", params: {} })
    .catch((cause: unknown) => cause);

  expect(error).toBeInstanceOf(AgentRuntimeQueryError);
  expect(error).toMatchObject({ code: "runtime_unavailable" });
  const queryError = toRuntimeQueryError(
    "load runtime catalog",
    { repoPath: "/repo", runtimeKind: "codex", workingDirectory: "/repo" },
    error,
  );
  expect(queryError.failure.code).toBe("runtime_unavailable");
  expect(JSON.stringify(queryError.failure)).not.toContain("private-runtime");
});

test("keeps a Codex RPC error isolated to the calling surface", async () => {
  const rpcError = new HostOperationError({
    operation: "codexAppServerTransport.request.model/list",
    message: "Codex app-server request model/list failed",
    cause: { code: -32602, message: "Invalid params" },
  });
  const transport = createTransportWithRequest(() => Effect.fail(rpcError));

  await expect(transport.request({ method: "model/list", params: {} })).rejects.toBe(rpcError);
});
