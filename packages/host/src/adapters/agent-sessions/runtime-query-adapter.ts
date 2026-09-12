import { AgentRuntimeQueryError, type AgentSessionQueryParentPort } from "@openducktor/core";
import { Effect } from "effect";
import { ZodError } from "zod";
import { HostOperationError } from "../../effect/host-errors";
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
    listAvailableModels: (input) =>
      read("list models", input, () => native.listAvailableModels(input)),
    listAvailableSlashCommands: (input) =>
      read("list slash commands", input, () => native.listAvailableSlashCommands(input)),
    listAvailableSkills: (input) =>
      read("list skills", input, () => native.listAvailableSkills(input)),
    listAvailableSubagents: (input) =>
      read("list subagents", input, () => native.listAvailableSubagents(input)),
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
