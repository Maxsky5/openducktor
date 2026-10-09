import type { GitCheck, PathCheck, TaskStoreCheck } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import type { ScheduleTask } from "@/lib/scheduling";
import type { ObservedCheck } from "@/types/diagnostics";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  type ChecksQueryDependencies,
  classifyDiagnosticsQueryError,
  gitCheckQueryOptions,
  loadTaskStoreCheck,
  pathCheckQueryOptions,
  refreshPathAndGitChecks,
  taskStoreCheckQueryOptions,
} from "../../queries/checks";
import { buildDiagnosticsToastIssues } from "./check-diagnostics";
import { type DiagnosticsToastApi, useDiagnosticsToasts } from "./use-check-diagnostics-effects";

const DISABLED_REPO_PATH = "__disabled__";

type UseChecksArgs = {
  activeWorkspace: ActiveWorkspace | null;
  refreshHostRuntimeStatus: () => Promise<void>;
  pathCheck?: ChecksQueryDependencies["pathCheck"];
  gitCheck?: ChecksQueryDependencies["gitCheck"];
  taskStoreCheck?: ChecksQueryDependencies["taskStoreCheck"];
  scheduleTask?: ScheduleTask;
  toastApi?: DiagnosticsToastApi;
};

type UseChecksResult = {
  pathCheck: ObservedCheck<PathCheck>;
  gitCheck: ObservedCheck<GitCheck>;
  checksRepoPath: string | null;
  taskStoreCheck: ObservedCheck<TaskStoreCheck>;
  isRefreshingChecks: boolean;
  refreshTaskStoreCheckForRepo: (repoPath: string, force?: boolean) => Promise<TaskStoreCheck>;
  refreshChecks: () => Promise<void>;
};

export function useChecks({
  activeWorkspace,
  refreshHostRuntimeStatus,
  pathCheck,
  gitCheck,
  taskStoreCheck,
  scheduleTask,
  toastApi,
}: UseChecksArgs): UseChecksResult {
  const activeRepoPath = activeWorkspace?.repoPath ?? null;
  const queryClient = useQueryClient();
  const [isRefreshingChecks, setIsRefreshingChecks] = useState(false);
  const pathCheckQuery = useQuery(pathCheckQueryOptions(false, pathCheck, scheduleTask));
  const gitCheckQuery = useQuery(gitCheckQueryOptions(gitCheck, scheduleTask));
  const taskStoreCheckQuery = useQuery({
    ...taskStoreCheckQueryOptions(
      activeRepoPath ?? DISABLED_REPO_PATH,
      taskStoreCheck,
      scheduleTask,
    ),
    enabled: activeRepoPath !== null,
  });

  const refreshTaskStoreCheckForRepo = useCallback(
    (repoPath: string, force = false): Promise<TaskStoreCheck> =>
      loadTaskStoreCheck(queryClient, repoPath, taskStoreCheck, scheduleTask, force),
    [taskStoreCheck, queryClient, scheduleTask],
  );

  const refreshChecks = useCallback(async (): Promise<void> => {
    setIsRefreshingChecks(true);
    try {
      const checks: Promise<unknown>[] = [
        refreshHostRuntimeStatus(),
        refreshPathAndGitChecks(queryClient, pathCheck, gitCheck, scheduleTask),
      ];
      if (activeRepoPath !== null) {
        checks.push(refreshTaskStoreCheckForRepo(activeRepoPath, true));
      }
      await Promise.allSettled(checks);
    } finally {
      setIsRefreshingChecks(false);
    }
  }, [
    activeRepoPath,
    refreshHostRuntimeStatus,
    queryClient,
    pathCheck,
    gitCheck,
    scheduleTask,
    refreshTaskStoreCheckForRepo,
  ]);

  const pathCheckState = useMemo(
    () => toObservedCheck(pathCheckQuery.data, pathCheckQuery.dataUpdatedAt, pathCheckQuery.error),
    [pathCheckQuery.data, pathCheckQuery.dataUpdatedAt, pathCheckQuery.error],
  );
  const gitCheckState = useMemo(
    () => toObservedCheck(gitCheckQuery.data, gitCheckQuery.dataUpdatedAt, gitCheckQuery.error),
    [gitCheckQuery.data, gitCheckQuery.dataUpdatedAt, gitCheckQuery.error],
  );
  const taskStoreCheckState = useMemo((): ObservedCheck<TaskStoreCheck> => {
    const check = toObservedCheck(
      taskStoreCheckQuery.data,
      taskStoreCheckQuery.dataUpdatedAt,
      taskStoreCheckQuery.error,
    );
    return activeRepoPath === null ? { ...check, data: null } : check;
  }, [
    activeRepoPath,
    taskStoreCheckQuery.data,
    taskStoreCheckQuery.dataUpdatedAt,
    taskStoreCheckQuery.error,
  ]);
  const diagnosticsToastIssues = useMemo(
    () =>
      buildDiagnosticsToastIssues({
        activeWorkspace,
        pathCheck: pathCheckState,
        gitCheck: gitCheckState,
        taskStoreCheck: taskStoreCheckState,
      }),
    [activeWorkspace, pathCheckState, gitCheckState, taskStoreCheckState],
  );
  useDiagnosticsToasts(diagnosticsToastIssues, toastApi);

  return {
    pathCheck: pathCheckState,
    gitCheck: gitCheckState,
    checksRepoPath: activeRepoPath,
    taskStoreCheck: taskStoreCheckState,
    isRefreshingChecks,
    refreshTaskStoreCheckForRepo,
    refreshChecks,
  };
}

const toObservedCheck = <T>(
  data: T | undefined,
  dataUpdatedAt: number,
  error: Error | null,
): ObservedCheck<T> => {
  const failure = error ? classifyDiagnosticsQueryError(error) : null;
  return {
    data: data ?? null,
    error: failure?.message ?? null,
    failureKind: failure?.failureKind ?? null,
    observedAt: data === undefined ? null : new Date(dataUpdatedAt).toISOString(),
  };
};
