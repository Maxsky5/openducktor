import type { RuntimeCheck, RuntimeDescriptor, TaskStoreCheck } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { isRepoStoreReady } from "@/lib/repo-store-health";
import type { RepoRuntimeFailureKind, RepoRuntimeHealthMap } from "@/types/diagnostics";
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

type UseChecksArgs = {
  activeWorkspace: ActiveWorkspace | null;
  runtimeDefinitions: RuntimeDescriptor[];
  runtimeHealthByRuntime: RepoRuntimeHealthMap;
  isLoadingRepoRuntimeHealth: boolean;
  refreshRepoRuntimeHealth: () => Promise<RepoRuntimeHealthMap>;
  runtimeCheck?: ChecksQueryDependencies["runtimeCheck"];
  taskStoreCheck?: ChecksQueryDependencies["taskStoreCheck"];
  toastApi?: DiagnosticsToastApi;
};

type UseChecksResult = {
  runtimeCheck: RuntimeCheck | null;
  runtimeCheckFailureKind: RepoRuntimeFailureKind;
  activeTaskStoreCheck: TaskStoreCheck | null;
  taskStoreCheckFailureKind: RepoRuntimeFailureKind;
  isLoadingChecks: boolean;
  setIsLoadingChecks: (value: boolean) => void;
  refreshRuntimeCheck: (force?: boolean) => Promise<RuntimeCheck>;
  refreshTaskStoreCheckForRepo: (repoPath: string, force?: boolean) => Promise<TaskStoreCheck>;
  refreshChecks: () => Promise<void>;
  hasRuntimeCheck: () => boolean;
  hasCachedTaskStoreCheck: (repoPath: string) => boolean;
  clearActiveTaskStoreCheck: () => void;
};

export function useChecks({
  activeWorkspace,
  runtimeDefinitions,
  runtimeHealthByRuntime,
  isLoadingRepoRuntimeHealth,
  refreshRepoRuntimeHealth,
  runtimeCheck,
  taskStoreCheck,
  toastApi,
}: UseChecksArgs): UseChecksResult {
  const activeRepoPath = activeWorkspace?.repoPath ?? null;
  const queryClient = useQueryClient();
  const [isManualLoadingChecks, setIsManualLoadingChecks] = useState(false);
  const runtimeCheckQuery = useQuery(runtimeCheckQueryOptions(false, runtimeCheck));
  const taskStoreCheckQuery = useQuery({
    ...taskStoreCheckQueryOptions(activeRepoPath ?? "__disabled__", taskStoreCheck),
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
        return queryClient.fetchQuery(runtimeCheckQueryOptions(true, runtimeCheck));
      }

      return loadRuntimeCheckFromQuery(queryClient, runtimeCheck);
    },
    [queryClient, runtimeCheck],
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
        ? queryClient.fetchQuery(taskStoreCheckQueryOptions(repoPath, taskStoreCheck))
        : loadTaskStoreCheckFromQuery(queryClient, repoPath, taskStoreCheck);
    },
    [taskStoreCheck, queryClient],
  );

  const refreshChecks = useCallback(async (): Promise<void> => {
    if (!activeRepoPath) {
      return;
    }

    setIsManualLoadingChecks(true);
    try {
      const [runtimeResult, taskStoreResult, runtimeHealthResult] = await Promise.allSettled([
        refreshRuntimeCheck(true),
        refreshTaskStoreCheckForRepo(activeRepoPath, true),
        refreshRepoRuntimeHealth(),
      ]);

      if (runtimeResult.status === "rejected") {
        throw runtimeResult.reason;
      }

      if (taskStoreResult.status === "rejected") {
        throw taskStoreResult.reason;
      }

      if (runtimeHealthResult.status === "rejected") {
        throw runtimeHealthResult.reason;
      }

      const runtime = runtimeResult.value;
      const taskStore = taskStoreResult.value;

      if (runtime && taskStore && runtime.gitOk && isRepoStoreReady(taskStore)) {
        return;
      }
    } finally {
      setIsManualLoadingChecks(false);
    }
  }, [activeRepoPath, refreshTaskStoreCheckForRepo, refreshRuntimeCheck, refreshRepoRuntimeHealth]);

  const hasCachedTaskStoreCheck = useCallback(
    (repoPath: string): boolean => {
      return (
        queryClient.getQueryData(taskStoreCheckQueryOptions(repoPath, taskStoreCheck).queryKey) !==
        undefined
      );
    },
    [taskStoreCheck, queryClient],
  );

  const hasRuntimeCheck = useCallback((): boolean => {
    return (
      queryClient.getQueryData(runtimeCheckQueryOptions(false, runtimeCheck).queryKey) !== undefined
    );
  }, [queryClient, runtimeCheck]);

  const clearActiveTaskStoreCheck = useCallback(() => {
    setIsManualLoadingChecks(false);
    if (activeRepoPath === null) {
      return;
    }
    queryClient.removeQueries({
      queryKey: checksQueryKeys.taskStore(activeRepoPath),
      exact: true,
    });
  }, [activeRepoPath, queryClient]);

  const runtimeCheckQueryFailure = runtimeCheckQuery.error
    ? classifyDiagnosticsQueryError(runtimeCheckQuery.error)
    : null;
  const runtimeCheckError = runtimeCheckQueryFailure?.message ?? null;
  const runtimeCheckFailureKind = runtimeCheckQueryFailure?.failureKind ?? null;
  const runtimeCheckState = useMemo((): RuntimeCheck | null => {
    if (runtimeCheckQuery.data) {
      return runtimeCheckQuery.data;
    }

    if (runtimeCheckError) {
      return buildRuntimeCheckErrorState(runtimeDefinitions, runtimeCheckError);
    }

    return null;
  }, [runtimeCheckError, runtimeCheckQuery.data, runtimeDefinitions]);
  const taskStoreCheckQueryFailure = taskStoreCheckQuery.error
    ? classifyDiagnosticsQueryError(taskStoreCheckQuery.error)
    : null;
  const taskStoreCheckError = taskStoreCheckQueryFailure?.message ?? null;
  const taskStoreCheckFailureKind = taskStoreCheckQueryFailure?.failureKind ?? null;
  const rawTaskStoreCheck = useMemo((): TaskStoreCheck | null => {
    if (activeRepoPath === null) {
      return null;
    }

    if (taskStoreCheckQuery.data) {
      return taskStoreCheckQuery.data;
    }

    if (taskStoreCheckError) {
      return buildTaskStoreCheckErrorState(taskStoreCheckError);
    }

    return null;
  }, [activeRepoPath, taskStoreCheckError, taskStoreCheckQuery.data]);
  const diagnosticsToastIssues = useMemo(
    (): DiagnosticsToastIssue[] =>
      buildDiagnosticsToastIssues({
        activeWorkspace,
        runtimeDefinitions,
        runtimeCheck: runtimeCheckState,
        runtimeCheckError,
        runtimeCheckFailureKind,
        taskStoreCheck: rawTaskStoreCheck,
        taskStoreCheckError,
        taskStoreCheckFailureKind,
        runtimeHealthByRuntime,
      }),
    [
      activeWorkspace,
      rawTaskStoreCheck,
      runtimeHealthByRuntime,
      taskStoreCheckError,
      taskStoreCheckFailureKind,
      runtimeCheckState,
      runtimeCheckError,
      runtimeCheckFailureKind,
      runtimeDefinitions,
    ],
  );

  useDiagnosticsToasts(diagnosticsToastIssues, toastApi);

  const isLoadingChecks =
    isManualLoadingChecks ||
    runtimeCheckQuery.isFetching ||
    (activeRepoPath !== null && (taskStoreCheckQuery.isFetching || isLoadingRepoRuntimeHealth));

  return {
    runtimeCheck: runtimeCheckState,
    runtimeCheckFailureKind,
    activeTaskStoreCheck: rawTaskStoreCheck,
    taskStoreCheckFailureKind,
    isLoadingChecks,
    setIsLoadingChecks: setIsManualLoadingChecks,
    refreshRuntimeCheck,
    refreshTaskStoreCheckForRepo,
    refreshChecks,
    hasRuntimeCheck,
    hasCachedTaskStoreCheck,
    clearActiveTaskStoreCheck,
  };
}
