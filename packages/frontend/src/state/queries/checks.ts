import type {
  RuntimeCheck,
  RuntimeDescriptor,
  RuntimeKind,
  TaskStoreCheck,
} from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { errorMessage } from "@/lib/errors";
import { ODT_MCP_SERVER_NAME } from "@/lib/openducktor-mcp";
import type {
  RepoRuntimeFailureKind,
  RepoRuntimeHealthCheck,
  RepoRuntimeHealthMap,
} from "@/types/diagnostics";
import { host } from "../operations/host";

export type ChecksQueryDependencies = {
  runtimeCheck: (force?: boolean) => Promise<RuntimeCheck>;
  taskStoreCheck: (repoPath: string) => Promise<TaskStoreCheck>;
};

const RUNTIME_CHECK_STALE_TIME_MS = 5 * 60_000;
const TASK_STORE_CHECK_STALE_TIME_MS = 60_000;
const RUNTIME_HEALTH_STALE_TIME_MS = 60_000;
const DIAGNOSTICS_QUERY_TIMEOUT_MS = 15_000;

const DEFAULT_CHECKS_QUERY_DEPENDENCIES: ChecksQueryDependencies = {
  runtimeCheck: (force = false) => host.runtimeCheck(force),
  taskStoreCheck: (repoPath) => host.taskStoreCheck(repoPath),
};

const buildRuntimeHealthErrorCheck = (
  runtimeHealthError: string,
  checkedAt: string,
): RepoRuntimeHealthCheck => ({
  status: "error",
  checkedAt,
  runtime: {
    status: "error",
    stage: "startup_failed",
    observation: null,
    instance: null,
    startedAt: null,
    updatedAt: checkedAt,
    elapsedMs: null,
    attempts: null,
    detail: runtimeHealthError,
    failureKind: "error",
    failureReason: null,
  },
  mcp: {
    supported: true,
    status: "error",
    serverName: ODT_MCP_SERVER_NAME,
    serverStatus: null,
    toolIds: [],
    detail: runtimeHealthError,
    failureKind: "error",
  },
});

const sortRuntimeKindsForQueryKey = (runtimeKinds: RuntimeKind[]): RuntimeKind[] =>
  runtimeKinds.toSorted();

export class DiagnosticsQueryTimeoutError extends Error {
  readonly failureKind = "timeout" as const;
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Timed out after ${timeoutMs}ms`);
    this.name = "DiagnosticsQueryTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export const classifyDiagnosticsQueryError = (
  error: unknown,
): { message: string; failureKind: Exclude<RepoRuntimeFailureKind, null> } => {
  if (error instanceof DiagnosticsQueryTimeoutError) {
    return {
      message: error.message,
      failureKind: error.failureKind,
    };
  }

  return {
    message: errorMessage(error),
    failureKind: "error",
  };
};

const withDiagnosticsQueryTimeout = async <T>(promise: Promise<T>): Promise<T> => {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      reject(new DiagnosticsQueryTimeoutError(DIAGNOSTICS_QUERY_TIMEOUT_MS));
    }, DIAGNOSTICS_QUERY_TIMEOUT_MS);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
  }
};

export const checksQueryKeys = {
  all: ["checks"] as const,
  runtime: () => [...checksQueryKeys.all, "runtime"] as const,
  taskStore: (repoPath: string) => [...checksQueryKeys.all, "task-store", repoPath] as const,
  runtimeHealth: (repoPath: string, runtimeKinds: RuntimeKind[]) =>
    [
      ...checksQueryKeys.all,
      "runtime-health",
      repoPath,
      ...sortRuntimeKindsForQueryKey(runtimeKinds),
    ] as const,
};

export const runtimeCheckQueryOptions = (
  force = false,
  runtimeCheck: ChecksQueryDependencies["runtimeCheck"] = DEFAULT_CHECKS_QUERY_DEPENDENCIES.runtimeCheck,
) =>
  queryOptions({
    queryKey: checksQueryKeys.runtime(),
    queryFn: (): Promise<RuntimeCheck> => withDiagnosticsQueryTimeout(runtimeCheck(force)),
    staleTime: RUNTIME_CHECK_STALE_TIME_MS,
  });

export const taskStoreCheckQueryOptions = (
  repoPath: string,
  taskStoreCheck: ChecksQueryDependencies["taskStoreCheck"] = DEFAULT_CHECKS_QUERY_DEPENDENCIES.taskStoreCheck,
) =>
  queryOptions({
    queryKey: checksQueryKeys.taskStore(repoPath),
    queryFn: (): Promise<TaskStoreCheck> => withDiagnosticsQueryTimeout(taskStoreCheck(repoPath)),
    staleTime: TASK_STORE_CHECK_STALE_TIME_MS,
  });

export const repoRuntimeHealthQueryOptions = (
  repoPath: string,
  runtimeDefinitions: RuntimeDescriptor[],
  checkRepoRuntimeHealth: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<RepoRuntimeHealthCheck>,
) =>
  queryOptions({
    queryKey: checksQueryKeys.runtimeHealth(
      repoPath,
      runtimeDefinitions.map((definition) => definition.kind),
    ),
    queryFn: async (): Promise<RepoRuntimeHealthMap> => {
      const checks = await Promise.all(
        runtimeDefinitions.map(async (definition) => {
          let check: RepoRuntimeHealthCheck;

          try {
            check = await checkRepoRuntimeHealth(repoPath, definition.kind);
          } catch (error) {
            check = buildRuntimeHealthErrorCheck(errorMessage(error), new Date().toISOString());
          }

          return [definition.kind, check] as const;
        }),
      );

      return Object.fromEntries(checks) as RepoRuntimeHealthMap;
    },
    staleTime: RUNTIME_HEALTH_STALE_TIME_MS,
  });

export const loadRuntimeCheckFromQuery = (
  queryClient: QueryClient,
  runtimeCheck: ChecksQueryDependencies["runtimeCheck"] = DEFAULT_CHECKS_QUERY_DEPENDENCIES.runtimeCheck,
): Promise<RuntimeCheck> => queryClient.fetchQuery(runtimeCheckQueryOptions(false, runtimeCheck));

export const loadTaskStoreCheckFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskStoreCheck: ChecksQueryDependencies["taskStoreCheck"] = DEFAULT_CHECKS_QUERY_DEPENDENCIES.taskStoreCheck,
): Promise<TaskStoreCheck> =>
  queryClient.fetchQuery(taskStoreCheckQueryOptions(repoPath, taskStoreCheck));
