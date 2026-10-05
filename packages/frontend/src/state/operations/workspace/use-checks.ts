import type { RuntimeCheck, RuntimeDescriptor, TaskStoreCheck } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import type { ScheduleTask } from "@/lib/scheduling";
import type { ObservedCheck } from "@/types/diagnostics";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  type ChecksQueryDependencies,
  checksQueryKeys,
  classifyDiagnosticsQueryError,
  loadRuntimeCheckFromQuery,
  loadTaskStoreCheckFromQuery,
  runtimeCheckQueryOptions,
  taskStoreCheckQueryOptions,
} from "../../queries/checks";
import {
  buildDiagnosticsToastIssues,
  buildRuntimeCheckErrorState,
  buildTaskStoreCheckErrorState,
  type DiagnosticsToastIssue,
} from "./check-diagnostics";
import { type DiagnosticsToastApi, useDiagnosticsToasts } from "./use-check-diagnostics-effects";

const DISABLED_REPO_PATH = "__disabled__";

type UseChecksArgs = {
  activeWorkspace: ActiveWorkspace | null;
  runtimeDefinitions: RuntimeDescriptor[];
  refreshHostRuntimeStatus: () => Promise<void>;
  runtimeCheck?: ChecksQueryDependencies["runtimeCheck"];
  taskStoreCheck?: ChecksQueryDependencies["taskStoreCheck"];
  scheduleTask?: ScheduleTask;
  toastApi?: DiagnosticsToastApi;
};

type UseChecksResult = {
  runtimeCheck: ObservedCheck<RuntimeCheck>;
  checksRepoPath: string | null;
  taskStoreCheck: ObservedCheck<TaskStoreCheck>;
  isRefreshingChecks: boolean;
  refreshTaskStoreCheckForRepo: (repoPath: string, force?: boolean) => Promise<TaskStoreCheck>;
  refreshChecks: () => Promise<void>;
};

const toObservedCheck = <T>(
  data: T | undefined,
  dataUpdatedAt: number,
  error: Error | null,
  buildFailurePlaceholder: (error: string) => T,
): ObservedCheck<T> => {
  const failure = error ? classifyDiagnosticsQueryError(error) : null;
  let observedData: T | null = null;
  if (data) {
    observedData = data;
  } else if (failure) {
    observedData = buildFailurePlaceholder(failure.message);
  }
  return {
    data: observedData,
    error: failure?.message ?? null,
    failureKind: failure?.failureKind ?? null,
    observedAt: data === undefined ? null : new Date(dataUpdatedAt).toISOString(),
  };
};

export function useChecks({
  activeWorkspace,
  runtimeDefinitions,
  refreshHostRuntimeStatus,
  runtimeCheck,
  taskStoreCheck,
  scheduleTask,
  toastApi,
}: UseChecksArgs): UseChecksResult {
  const activeRepoPath = activeWorkspace?.repoPath ?? null;
  const queryClient = useQueryClient();
  const [isRefreshingChecks, setIsRefreshingChecks] = useState(false);
  const runtimeCheckQuery = useQuery(runtimeCheckQueryOptions(false, runtimeCheck, scheduleTask));
  // Workspace reads keep their repository key, so a switch never shows another workspace's data.
  const taskStoreCheckQuery = useQuery({
    ...taskStoreCheckQueryOptions(
      activeRepoPath ?? DISABLED_REPO_PATH,
      taskStoreCheck,
      scheduleTask,
    ),
    enabled: activeRepoPath !== null,
  });

  const refreshRuntimeCheck = useCallback(
    async (force = false): Promise<RuntimeCheck> => {
      if (force) {
        await queryClient.invalidateQueries({
          queryKey: checksQueryKeys.runtime(),
          exact: true,
          refetchType: "none",
        });
        return queryClient.fetchQuery(runtimeCheckQueryOptions(true, runtimeCheck, scheduleTask));
      }

      return loadRuntimeCheckFromQuery(queryClient, runtimeCheck, scheduleTask);
    },
    [queryClient, runtimeCheck, scheduleTask],
  );

  const refreshTaskStoreCheckForRepo = useCallback(
    async (repoPath: string, force = false): Promise<TaskStoreCheck> => {
      if (force) {
        await queryClient.invalidateQueries({
          queryKey: checksQueryKeys.taskStore(repoPath),
          exact: true,
          refetchType: "none",
        });
      }

      return force
        ? queryClient.fetchQuery(taskStoreCheckQueryOptions(repoPath, taskStoreCheck, scheduleTask))
        : loadTaskStoreCheckFromQuery(queryClient, repoPath, taskStoreCheck, scheduleTask);
    },
    [taskStoreCheck, queryClient, scheduleTask],
  );

  const refreshChecks = useCallback(async (): Promise<void> => {
    setIsRefreshingChecks(true);
    try {
      // Each check reports its own failure in its query state. One failure does not stop another.
      await Promise.allSettled([
        refreshHostRuntimeStatus(),
        refreshRuntimeCheck(true),
        ...(activeRepoPath === null ? [] : [refreshTaskStoreCheckForRepo(activeRepoPath, true)]),
      ]);
    } finally {
      setIsRefreshingChecks(false);
    }
  }, [activeRepoPath, refreshHostRuntimeStatus, refreshRuntimeCheck, refreshTaskStoreCheckForRepo]);

  const runtimeCheckState = useMemo(
    (): ObservedCheck<RuntimeCheck> =>
      toObservedCheck(
        runtimeCheckQuery.data,
        runtimeCheckQuery.dataUpdatedAt,
        runtimeCheckQuery.error,
        (error) => buildRuntimeCheckErrorState(runtimeDefinitions, error),
      ),
    [
      runtimeCheckQuery.data,
      runtimeCheckQuery.dataUpdatedAt,
      runtimeCheckQuery.error,
      runtimeDefinitions,
    ],
  );
  const taskStoreCheckState = useMemo((): ObservedCheck<TaskStoreCheck> => {
    const check = toObservedCheck(
      taskStoreCheckQuery.data,
      taskStoreCheckQuery.dataUpdatedAt,
      taskStoreCheckQuery.error,
      buildTaskStoreCheckErrorState,
    );
    return activeRepoPath === null ? { ...check, data: null } : check;
  }, [
    activeRepoPath,
    taskStoreCheckQuery.data,
    taskStoreCheckQuery.dataUpdatedAt,
    taskStoreCheckQuery.error,
  ]);
  const diagnosticsToastIssues = useMemo(
    (): DiagnosticsToastIssue[] =>
      buildDiagnosticsToastIssues({
        activeWorkspace,
        runtimeCheck: runtimeCheckState,
        taskStoreCheck: taskStoreCheckState,
      }),
    [activeWorkspace, runtimeCheckState, taskStoreCheckState],
  );

  useDiagnosticsToasts(diagnosticsToastIssues, toastApi);

  return {
    runtimeCheck: runtimeCheckState,
    checksRepoPath: activeRepoPath,
    taskStoreCheck: taskStoreCheckState,
    isRefreshingChecks,
    refreshTaskStoreCheckForRepo,
    refreshChecks,
  };
}
