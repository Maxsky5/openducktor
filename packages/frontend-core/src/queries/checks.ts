import { workspaceScopeValue } from "./workspace-scope";
import type { GitCheck, PathCheck, TaskStoreCheck, WorkspaceRef } from "@openducktor/contracts";
import { type QueryClient, type QueryKey, queryOptions } from "@tanstack/react-query";
import { waitWithAbort } from "@openducktor/host-client/remote";
import { errorMessage } from "../lib/errors";
import { scheduleTask, type ScheduleTask } from "../lib/scheduling";
import type { DiagnosticsFailureKind } from "../types/diagnostics";
import { connectionHost } from "../connection/client-connection";
import { SKIPPED_QUERY_KEY_SEGMENT, skippedQueryOptions } from "./skipped-query";

export type ChecksQueryDependencies = {
  pathCheck: (force: boolean, signal: AbortSignal) => Promise<PathCheck>;
  gitCheck: (signal: AbortSignal) => Promise<GitCheck>;
  taskStoreCheck: (scope: WorkspaceRef, signal: AbortSignal) => Promise<TaskStoreCheck>;
};

const HOST_CHECK_STALE_TIME_MS = 5 * 60_000;
const TASK_STORE_CHECK_STALE_TIME_MS = 60_000;
const DIAGNOSTICS_QUERY_TIMEOUT_MS = 15_000;
// Allow time for the login-shell probe, which has its own 15-second limit.
const PATH_CHECK_TIMEOUT_MS = 30_000;

const hostChecks = (queryClient: QueryClient): ChecksQueryDependencies => {
  const host = connectionHost(queryClient);
  return {
    pathCheck: (force, signal) => host.pathCheck(force, { signal }),
    gitCheck: (signal) => host.gitCheck({ signal }),
    taskStoreCheck: (repoPath, signal) => host.taskStoreCheck(repoPath, { signal }),
  };
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
  taskStore: (scope: WorkspaceRef) =>
    [...checksQueryKeys.all, "task-store", workspaceScopeValue(scope)] as const,
  taskStoreSkipped: () =>
    [...checksQueryKeys.all, SKIPPED_QUERY_KEY_SEGMENT, "task-store"] as const,
};

export const pathCheckQueryOptions = (
  force = false,
  pathCheck?: ChecksQueryDependencies["pathCheck"],
  scheduler: ScheduleTask = scheduleTask,
) =>
  queryOptions({
    queryKey: checksQueryKeys.path(),
    queryFn: ({ client, signal }): Promise<PathCheck> =>
      withDiagnosticsQueryTimeout(
        (timeoutSignal) => (pathCheck ?? hostChecks(client).pathCheck)(force, timeoutSignal),
        scheduler,
        signal,
        PATH_CHECK_TIMEOUT_MS,
      ),
    staleTime: HOST_CHECK_STALE_TIME_MS,
  });

export const gitCheckQueryOptions = (
  gitCheck?: ChecksQueryDependencies["gitCheck"],
  scheduler: ScheduleTask = scheduleTask,
) =>
  queryOptions({
    queryKey: checksQueryKeys.git(),
    queryFn: ({ client, signal }): Promise<GitCheck> =>
      withDiagnosticsQueryTimeout(
        (timeoutSignal) => (gitCheck ?? hostChecks(client).gitCheck)(timeoutSignal),
        scheduler,
        signal,
      ),
    staleTime: HOST_CHECK_STALE_TIME_MS,
  });

export const taskStoreCheckQueryOptions = (
  repoPath: WorkspaceRef,
  taskStoreCheck?: ChecksQueryDependencies["taskStoreCheck"],
  scheduler: ScheduleTask = scheduleTask,
) =>
  queryOptions<TaskStoreCheck, Error, TaskStoreCheck, QueryKey>({
    queryKey: checksQueryKeys.taskStore(repoPath),
    queryFn: ({ client, signal }): Promise<TaskStoreCheck> =>
      withDiagnosticsQueryTimeout(
        (timeoutSignal) =>
          (taskStoreCheck ?? hostChecks(client).taskStoreCheck)(repoPath, timeoutSignal),
        scheduler,
        signal,
      ),
    staleTime: TASK_STORE_CHECK_STALE_TIME_MS,
  });

export const taskStoreCheckQueryOptionsOrSkip = (repoPath: WorkspaceRef | null) =>
  repoPath === null
    ? skippedQueryOptions<TaskStoreCheck, QueryKey>({
        queryKey: checksQueryKeys.taskStoreSkipped(),
        staleTime: TASK_STORE_CHECK_STALE_TIME_MS,
      })
    : taskStoreCheckQueryOptions(repoPath);

/** Refresh PATH before Git, and keep each failure in its own query. */
export const refreshPathAndGitChecks = async (
  queryClient: QueryClient,
  pathCheck?: ChecksQueryDependencies["pathCheck"],
  gitCheck?: ChecksQueryDependencies["gitCheck"],
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
  repoPath: WorkspaceRef,
  taskStoreCheck?: ChecksQueryDependencies["taskStoreCheck"],
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

/**
 * Runs a diagnostics read with a deadline. The timeout aborts the request, so it releases its
 * resources, and the read fails with `DiagnosticsQueryTimeoutError`. A query cancellation also
 * aborts the request.
 */
export const withDiagnosticsQueryTimeout = async <T>(
  run: (signal: AbortSignal) => Promise<T>,
  scheduler: ScheduleTask,
  querySignal: AbortSignal,
  timeoutMs = DIAGNOSTICS_QUERY_TIMEOUT_MS,
): Promise<T> => {
  const timeout = new AbortController();
  const cancelTimeout = scheduler(() => {
    timeout.abort(new DiagnosticsQueryTimeoutError(timeoutMs));
  }, timeoutMs);
  const signal = AbortSignal.any([querySignal, timeout.signal]);
  try {
    return await waitWithAbort(run(signal), signal);
  } finally {
    cancelTimeout();
  }
};
