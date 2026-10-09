import type { GitCheck, PathCheck, TaskStoreCheck } from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { errorMessage } from "@/lib/errors";
import { scheduleTask, type ScheduleTask } from "@/lib/scheduling";
import type { DiagnosticsFailureKind } from "@/types/diagnostics";
import { host } from "../operations/host";

export type ChecksQueryDependencies = {
  pathCheck: (force?: boolean) => Promise<PathCheck>;
  gitCheck: () => Promise<GitCheck>;
  taskStoreCheck: (repoPath: string) => Promise<TaskStoreCheck>;
};

const HOST_CHECK_STALE_TIME_MS = 5 * 60_000;
const TASK_STORE_CHECK_STALE_TIME_MS = 60_000;
const DIAGNOSTICS_QUERY_TIMEOUT_MS = 15_000;
// Allow time for the login-shell probe, which has its own 15-second limit.
const PATH_CHECK_TIMEOUT_MS = 30_000;

const DEFAULT_CHECKS_QUERY_DEPENDENCIES: ChecksQueryDependencies = {
  pathCheck: (force = false) => host.pathCheck(force),
  gitCheck: () => host.gitCheck(),
  taskStoreCheck: (repoPath) => host.taskStoreCheck(repoPath),
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

export const checksQueryKeys = {
  all: ["checks"] as const,
  path: () => [...checksQueryKeys.all, "path"] as const,
  git: () => [...checksQueryKeys.all, "git"] as const,
  taskStore: (repoPath: string) => [...checksQueryKeys.all, "task-store", repoPath] as const,
};

export const pathCheckQueryOptions = (
  force = false,
  pathCheck: ChecksQueryDependencies["pathCheck"] = DEFAULT_CHECKS_QUERY_DEPENDENCIES.pathCheck,
  scheduler: ScheduleTask = scheduleTask,
) =>
  queryOptions({
    queryKey: checksQueryKeys.path(),
    queryFn: (): Promise<PathCheck> =>
      withDiagnosticsQueryTimeout(pathCheck(force), scheduler, PATH_CHECK_TIMEOUT_MS),
    staleTime: HOST_CHECK_STALE_TIME_MS,
  });

export const gitCheckQueryOptions = (
  gitCheck: ChecksQueryDependencies["gitCheck"] = DEFAULT_CHECKS_QUERY_DEPENDENCIES.gitCheck,
  scheduler: ScheduleTask = scheduleTask,
) =>
  queryOptions({
    queryKey: checksQueryKeys.git(),
    queryFn: (): Promise<GitCheck> => withDiagnosticsQueryTimeout(gitCheck(), scheduler),
    staleTime: HOST_CHECK_STALE_TIME_MS,
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

/** Refresh PATH before Git, and keep each failure in its own query. */
export const refreshPathAndGitChecks = async (
  queryClient: QueryClient,
  pathCheck: ChecksQueryDependencies["pathCheck"] = DEFAULT_CHECKS_QUERY_DEPENDENCIES.pathCheck,
  gitCheck: ChecksQueryDependencies["gitCheck"] = DEFAULT_CHECKS_QUERY_DEPENDENCIES.gitCheck,
  scheduler: ScheduleTask = scheduleTask,
): Promise<void> => {
  // Query reuses a pending request for the same key. Wait before forcing a new PATH read.
  if (queryClient.isFetching({ queryKey: checksQueryKeys.path(), exact: true }) > 0) {
    await Promise.allSettled([
      queryClient.fetchQuery(pathCheckQueryOptions(false, pathCheck, scheduler)),
    ]);
  }
  await queryClient.invalidateQueries({
    queryKey: checksQueryKeys.path(),
    exact: true,
    refetchType: "none",
  });
  // Git needs the refreshed PATH. A failed PATH read must not block the Git check.
  await Promise.allSettled([
    queryClient.fetchQuery(pathCheckQueryOptions(true, pathCheck, scheduler)),
  ]);
  if (queryClient.isFetching({ queryKey: checksQueryKeys.git(), exact: true }) > 0) {
    await Promise.allSettled([queryClient.fetchQuery(gitCheckQueryOptions(gitCheck, scheduler))]);
  }
  await queryClient.invalidateQueries({
    queryKey: checksQueryKeys.git(),
    exact: true,
    refetchType: "none",
  });
  await queryClient.fetchQuery(gitCheckQueryOptions(gitCheck, scheduler));
};

export const loadTaskStoreCheck = async (
  queryClient: QueryClient,
  repoPath: string,
  taskStoreCheck: ChecksQueryDependencies["taskStoreCheck"] = DEFAULT_CHECKS_QUERY_DEPENDENCIES.taskStoreCheck,
  scheduler: ScheduleTask = scheduleTask,
  force = false,
): Promise<TaskStoreCheck> => {
  if (force) {
    await queryClient.invalidateQueries({
      queryKey: checksQueryKeys.taskStore(repoPath),
      exact: true,
      refetchType: "none",
    });
  }
  return queryClient.fetchQuery(taskStoreCheckQueryOptions(repoPath, taskStoreCheck, scheduler));
};

type CheckFailure = {
  message: string;
  failureKind: Exclude<DiagnosticsFailureKind, null>;
};

export const classifyDiagnosticsQueryError = (cause: unknown): CheckFailure => {
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
  timeoutMs = DIAGNOSTICS_QUERY_TIMEOUT_MS,
): Promise<T> => {
  const { promise: timeoutPromise, reject: rejectTimeout } = Promise.withResolvers<never>();
  const cancelTimeout = scheduler(() => {
    rejectTimeout(new DiagnosticsQueryTimeoutError(timeoutMs));
  }, timeoutMs);

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    cancelTimeout();
  }
};
