import type {
  HostMcpBridgeCheck,
  RuntimeCheck,
  TaskStoreCheck,
  WorkspaceRuntimeMcpCheck,
} from "@openducktor/contracts";
import { type QueryClient, type QueryKey, queryOptions } from "@tanstack/react-query";
import { errorMessage } from "@/lib/errors";
import { scheduleTask, type ScheduleTask } from "@/lib/scheduling";
import type { DiagnosticsFailureKind } from "@/types/diagnostics";
import { host } from "../operations/host";

export type ChecksQueryDependencies = {
  runtimeCheck: (force?: boolean) => Promise<RuntimeCheck>;
  taskStoreCheck: (repoPath: string) => Promise<TaskStoreCheck>;
  hostMcpBridgeCheck: () => Promise<HostMcpBridgeCheck>;
  workspaceRuntimeMcpCheck: (repoPath: string) => Promise<WorkspaceRuntimeMcpCheck>;
};

const RUNTIME_CHECK_STALE_TIME_MS = 5 * 60_000;
const TASK_STORE_CHECK_STALE_TIME_MS = 60_000;
const HOST_MCP_BRIDGE_CHECK_STALE_TIME_MS = 5 * 60_000;
const WORKSPACE_RUNTIME_MCP_CHECK_STALE_TIME_MS = 60_000;
const DIAGNOSTICS_QUERY_TIMEOUT_MS = 15_000;

const DEFAULT_CHECKS_QUERY_DEPENDENCIES: ChecksQueryDependencies = {
  runtimeCheck: (force = false) => host.runtimeCheck(force),
  taskStoreCheck: (repoPath) => host.taskStoreCheck(repoPath),
  hostMcpBridgeCheck: () => host.hostMcpBridgeCheck(),
  workspaceRuntimeMcpCheck: (repoPath) => host.workspaceRuntimeMcpCheck(repoPath),
};

export class DiagnosticsQueryTimeoutError extends Error {
  readonly failureKind = "timeout" as const;
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Timed out after ${timeoutMs}ms`);
    this.name = "DiagnosticsQueryTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

type ClassifiedDiagnosticsQueryError = {
  message: string;
  failureKind: Exclude<DiagnosticsFailureKind, null>;
};

export const classifyDiagnosticsQueryError = (cause: unknown): ClassifiedDiagnosticsQueryError => {
  if (cause instanceof DiagnosticsQueryTimeoutError) {
    return {
      message: cause.message,
      failureKind: cause.failureKind,
    };
  }

  return {
    message: errorMessage(cause),
    failureKind: "error",
  };
};

export const withDiagnosticsQueryTimeout = async <T>(
  promise: Promise<T>,
  scheduler: ScheduleTask,
): Promise<T> => {
  const { promise: timeoutPromise, reject: rejectTimeout } = Promise.withResolvers<never>();
  const cancelTimeout = scheduler(() => {
    rejectTimeout(new DiagnosticsQueryTimeoutError(DIAGNOSTICS_QUERY_TIMEOUT_MS));
  }, DIAGNOSTICS_QUERY_TIMEOUT_MS);

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    cancelTimeout();
  }
};

export const checksQueryKeys = {
  all: ["checks"] as const,
  runtime: () => [...checksQueryKeys.all, "runtime"] as const,
  taskStore: (repoPath: string) => [...checksQueryKeys.all, "task-store", repoPath] as const,
  hostMcpBridge: () => [...checksQueryKeys.all, "host-mcp-bridge"] as const,
  workspaceRuntimeMcp: (repoPath: string) =>
    [...checksQueryKeys.all, "workspace-runtime-mcp", repoPath] as const,
  /** A workspace MCP check covers every kind, so a change of any kind's runtime makes it old. */
  matchesWorkspaceRuntimeMcp: (key: QueryKey): boolean =>
    key[0] === checksQueryKeys.all[0] && key[1] === "workspace-runtime-mcp",
};

export const runtimeCheckQueryOptions = (
  force = false,
  runtimeCheck: ChecksQueryDependencies["runtimeCheck"] = DEFAULT_CHECKS_QUERY_DEPENDENCIES.runtimeCheck,
  scheduler: ScheduleTask = scheduleTask,
) =>
  queryOptions({
    queryKey: checksQueryKeys.runtime(),
    queryFn: (): Promise<RuntimeCheck> =>
      withDiagnosticsQueryTimeout(runtimeCheck(force), scheduler),
    staleTime: RUNTIME_CHECK_STALE_TIME_MS,
  });

export const taskStoreCheckQueryOptions = (
  repoPath: string,
  taskStoreCheck: ChecksQueryDependencies["taskStoreCheck"] = DEFAULT_CHECKS_QUERY_DEPENDENCIES.taskStoreCheck,
  scheduler: ScheduleTask = scheduleTask,
) =>
  queryOptions({
    queryKey: checksQueryKeys.taskStore(repoPath),
    queryFn: (): Promise<TaskStoreCheck> =>
      withDiagnosticsQueryTimeout(taskStoreCheck(repoPath), scheduler),
    staleTime: TASK_STORE_CHECK_STALE_TIME_MS,
  });

export const hostMcpBridgeCheckQueryOptions = (
  hostMcpBridgeCheck: ChecksQueryDependencies["hostMcpBridgeCheck"] = DEFAULT_CHECKS_QUERY_DEPENDENCIES.hostMcpBridgeCheck,
  scheduler: ScheduleTask = scheduleTask,
) =>
  queryOptions({
    queryKey: checksQueryKeys.hostMcpBridge(),
    queryFn: (): Promise<HostMcpBridgeCheck> =>
      withDiagnosticsQueryTimeout(hostMcpBridgeCheck(), scheduler),
    staleTime: HOST_MCP_BRIDGE_CHECK_STALE_TIME_MS,
  });

export const workspaceRuntimeMcpCheckQueryOptions = (
  repoPath: string,
  workspaceRuntimeMcpCheck: ChecksQueryDependencies["workspaceRuntimeMcpCheck"] = DEFAULT_CHECKS_QUERY_DEPENDENCIES.workspaceRuntimeMcpCheck,
  scheduler: ScheduleTask = scheduleTask,
) =>
  queryOptions({
    queryKey: checksQueryKeys.workspaceRuntimeMcp(repoPath),
    queryFn: (): Promise<WorkspaceRuntimeMcpCheck> =>
      withDiagnosticsQueryTimeout(workspaceRuntimeMcpCheck(repoPath), scheduler),
    staleTime: WORKSPACE_RUNTIME_MCP_CHECK_STALE_TIME_MS,
  });

export const loadRuntimeCheckFromQuery = (
  queryClient: QueryClient,
  runtimeCheck: ChecksQueryDependencies["runtimeCheck"] = DEFAULT_CHECKS_QUERY_DEPENDENCIES.runtimeCheck,
  scheduler: ScheduleTask = scheduleTask,
): Promise<RuntimeCheck> =>
  queryClient.fetchQuery(runtimeCheckQueryOptions(false, runtimeCheck, scheduler));

export const loadTaskStoreCheckFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskStoreCheck: ChecksQueryDependencies["taskStoreCheck"] = DEFAULT_CHECKS_QUERY_DEPENDENCIES.taskStoreCheck,
  scheduler: ScheduleTask = scheduleTask,
): Promise<TaskStoreCheck> =>
  queryClient.fetchQuery(taskStoreCheckQueryOptions(repoPath, taskStoreCheck, scheduler));
