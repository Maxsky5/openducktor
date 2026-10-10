import { AgentRuntimeQueryError, type AgentSessionQueryParentPort } from "@openducktor/core";
import { Effect } from "effect";
import { ZodError } from "zod";
import { HostOperationError, readRuntimeOperationFailure } from "../../effect/host-errors";
import type {
  AgentRuntimeQueryAdapterPort,
  NativeAgentRuntimeQueries,
} from "../../ports/agent-runtime-query-port";
import { CodexSessionHistoryError } from "../../ports/codex-session-history-error";
import {
  RuntimeQueryError,
  runtimeQueryError,
  type RuntimeQueryIdentity,
} from "../../ports/runtime-query-error";

export const createRuntimeQueryAdapter = (
  native: NativeAgentRuntimeQueries & AgentSessionQueryParentPort,
): AgentRuntimeQueryAdapterPort => {
  const read = <Result>(
    operation: string,
    input: RuntimeQueryIdentity,
    run: () => Promise<Result>,
  ): Effect.Effect<Result, RuntimeQueryError> =>
    Effect.tryPromise({ try: run, catch: (cause) => toRuntimeQueryError(operation, input, cause) });
  return {
    resolveSessionParent: (input) =>
      read("read session parent", input, () => native.resolveSessionParent(input)),
    loadRuntimeCatalog: (input) =>
      read("load runtime catalog", input, () => native.loadRuntimeCatalog(input)),
    searchFiles: (input) => read("search files", input, () => native.searchFiles(input)),
    loadSessionHistory: (input) =>
      read("load session history", input, () => native.loadSessionHistory(input)),
    loadSessionTodos: (input) =>
      read("load session todos", input, () => native.loadSessionTodos(input)),
    loadSessionDiff: (input) =>
      read("load session diff", input, () => native.loadSessionDiff(input)),
    loadFileStatus: (input) => read("load file status", input, () => native.loadFileStatus(input)),
  };
};

export const toRuntimeQueryError = (
  operation: string,
  input: RuntimeQueryIdentity,
  cause: unknown,
): RuntimeQueryError => {
  if (cause instanceof RuntimeQueryError) return cause;
  const operationFailure = readRuntimeOperationFailure(cause)?.runtimeOperationFailure;
  if (operationFailure) {
    const code =
      operationFailure.code === "identity_mismatch"
        ? "scope_mismatch"
        : operationFailure.code === "runtime_unavailable" ||
            operationFailure.code === "unsupported_operation" ||
            operationFailure.code === "invalid_runtime_response"
          ? operationFailure.code
          : "request_failed";
    const detail = `${operationFailure.summary} ${operationFailure.nativeReason ?? ""} ${operationFailure.nextAction}`;
    const query = runtimeQueryError(operation, input, code, detail, cause);
    const failure = { ...query.failure, runtimeOperationFailure: operationFailure };
    if (operation === "load session history")
      failure.sessionHistoryFailure = {
        code: code === "invalid_runtime_response" ? "invalid_runtime_response" : "request_failed",
        summary: operationFailure.summary,
        detail,
      };
    return new RuntimeQueryError({
      message: detail,
      cause,
      failure,
    });
  }
  if (
    cause instanceof HostOperationError &&
    (cause.cause instanceof AgentRuntimeQueryError || cause.cause instanceof ZodError)
  )
    return toRuntimeQueryError(operation, input, cause.cause);
  if (cause instanceof AgentRuntimeQueryError)
    return runtimeQueryError(operation, input, cause.code, cause.message, cause);
  if (cause instanceof CodexSessionHistoryError) {
    const detail =
      "The runtime history read failed. Check the host logs with the diagnostic ID and retry this read.";
    const { code, diagnosticId, method, pageCursor, summary } = cause.failure;
    return new RuntimeQueryError({
      message: summary,
      failure: {
        ...runtimeQueryError(operation, input, code, detail).failure,
        sessionHistoryFailure: { code, diagnosticId, method, pageCursor, summary, detail },
      },
      cause,
    });
  }
  if (cause instanceof ZodError) {
    return runtimeQueryError(
      operation,
      input,
      "invalid_runtime_response",
      "The runtime returned invalid query data. Check the host runtime logs and update the runtime.",
      cause,
    );
  }
  return runtimeQueryError(
    operation,
    input,
    "request_failed",
    "The runtime query failed. Check the host runtime logs and retry this read.",
    cause,
  );
};
