import {
  AgentRuntimeQueryError,
  type AgentSessionQueryParentPort,
  type AgentUsageLimitPort,
} from "@openducktor/core";
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

type NativeQueries = NativeAgentRuntimeQueries & AgentSessionQueryParentPort;
type QueryMethods = NativeQueries & AgentUsageLimitPort;
type QueryMethod = keyof QueryMethods;
type UsageLimitMethod = keyof AgentUsageLimitPort;
type QuerySourceKind = "promise" | "effect";
type QueryResult<Source extends QuerySourceKind, Result> = Source extends "promise"
  ? Promise<Result>
  : Effect.Effect<Result, unknown>;

type RuntimeQuerySource<
  Source extends QuerySourceKind,
  Methods extends QueryMethod = keyof NativeQueries,
> = {
  readonly [Method in Methods]: (
    input: Parameters<QueryMethods[Method]>[0],
  ) => QueryResult<Source, Awaited<ReturnType<QueryMethods[Method]>>>;
};

const queryLabels = {
  resolveSessionParent: "read session parent",
  loadRuntimeCatalog: "load runtime catalog",
  searchFiles: "search files",
  loadSessionHistory: "load session history",
  loadSessionTodos: "load session todos",
  loadSessionDiff: "load session diff",
  loadFileStatus: "load file status",
  readLatestUsageLimitStop: "read latest usage limit stop",
  readUsageLimitRecovery: "read usage limit recovery",
} satisfies Record<QueryMethod, string>;

const unsupportedUsageLimitRead = (method: UsageLimitMethod, input: RuntimeQueryIdentity) =>
  runtimeQueryError(
    queryLabels[method],
    input,
    "unsupported_operation",
    "This runtime reports no structured usage limit reset time. Select Resume after the reset.",
  );

const createQueryAdapter = <Source extends QuerySourceKind>(
  native: RuntimeQuerySource<Source>,
  runQuery: <Result>(
    run: () => QueryResult<Source, Result>,
    mapError: (cause: unknown) => RuntimeQueryError,
  ) => Effect.Effect<Result, RuntimeQueryError>,
  usageLimits?: RuntimeQuerySource<Source, UsageLimitMethod>,
): AgentRuntimeQueryAdapterPort => {
  const read = <Result>(
    method: QueryMethod,
    input: RuntimeQueryIdentity,
    run: () => QueryResult<Source, Result>,
  ) => runQuery(run, (cause) => toRuntimeQueryError(method, input, cause));
  return {
    resolveSessionParent: (input) =>
      read("resolveSessionParent", input, () => native.resolveSessionParent(input)),
    loadRuntimeCatalog: (input) =>
      read("loadRuntimeCatalog", input, () => native.loadRuntimeCatalog(input)),
    searchFiles: (input) => read("searchFiles", input, () => native.searchFiles(input)),
    loadSessionHistory: (input) =>
      read("loadSessionHistory", input, () => native.loadSessionHistory(input)),
    loadSessionTodos: (input) =>
      read("loadSessionTodos", input, () => native.loadSessionTodos(input)),
    loadSessionDiff: (input) => read("loadSessionDiff", input, () => native.loadSessionDiff(input)),
    loadFileStatus: (input) => read("loadFileStatus", input, () => native.loadFileStatus(input)),
    readLatestUsageLimitStop: (input) =>
      usageLimits
        ? read("readLatestUsageLimitStop", input, () => usageLimits.readLatestUsageLimitStop(input))
        : Effect.fail(unsupportedUsageLimitRead("readLatestUsageLimitStop", input)),
    readUsageLimitRecovery: (input) =>
      usageLimits
        ? read("readUsageLimitRecovery", input, () => usageLimits.readUsageLimitRecovery(input))
        : Effect.fail(unsupportedUsageLimitRead("readUsageLimitRecovery", input)),
  };
};

export const createRuntimeQueryAdapter = (
  native: NativeQueries,
  usageLimits?: AgentUsageLimitPort,
): AgentRuntimeQueryAdapterPort =>
  createQueryAdapter<"promise">(
    native,
    (run, mapError) => Effect.tryPromise({ try: run, catch: mapError }),
    usageLimits,
  );

export const createEffectRuntimeQueryAdapter = (
  native: RuntimeQuerySource<"effect", keyof NativeQueries | "readLatestUsageLimitStop">,
): AgentRuntimeQueryAdapterPort =>
  createQueryAdapter<"effect">(
    native,
    (run, mapError) =>
      Effect.try({ try: run, catch: mapError }).pipe(
        Effect.flatMap((query) => Effect.mapError(query, mapError)),
      ),
    {
      readLatestUsageLimitStop: (input) => native.readLatestUsageLimitStop(input),
      // Claude reports the exact reset time of the stopped turn, and the resume waits until then.
      readUsageLimitRecovery: () => Effect.succeed({ kind: "recovered" }),
    },
  );

const toRuntimeQueryError = (
  method: QueryMethod,
  input: RuntimeQueryIdentity,
  cause: unknown,
): RuntimeQueryError => {
  if (cause instanceof RuntimeQueryError) return cause;
  const operation = queryLabels[method];
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
    if (method === "loadSessionHistory")
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
    return toRuntimeQueryError(method, input, cause.cause);
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
