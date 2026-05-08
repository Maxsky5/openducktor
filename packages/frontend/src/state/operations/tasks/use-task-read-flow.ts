import type { BeadsCheck, RepoStoreHealth, TaskCard } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type MutableRefObject, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import type { TaskDataRefreshOptions, TaskRefreshOptions } from "@/state/app-state-contexts";
import { refreshRepoTaskViewsFromQuery } from "@/state/queries/task-view-sync";
import { getBlockingRepoStoreHealth, summarizeTaskLoadError } from "@/state/tasks/task-load-errors";
import { repoTaskDataQueryOptions } from "../../queries/tasks";
import { settingsSnapshotQueryOptions } from "../../queries/workspace";
import { host } from "../shared/host";

const TASK_REFRESH_WARNING = "Pull request sync failed during task refresh";

type UseTaskReadFlowArgs = {
  activeRepoPath: string | null;
  refreshBeadsCheckForRepo: (repoPath: string, force?: boolean) => Promise<BeadsCheck>;
};

export type UseTaskReadFlowResult = {
  tasks: TaskCard[];
  isForegroundLoadingTasks: boolean;
  isRefreshingTasksInBackground: boolean;
  isLoadingTasks: boolean;
  setIsLoadingTasks: (value: boolean) => void;
  clearTaskReadState: () => void;
  refreshTaskData: (
    repoPath: string,
    taskIdOrIds?: string | string[],
    options?: TaskDataRefreshOptions,
  ) => Promise<void>;
  refreshTasksWithOptions: (options?: TaskRefreshOptions) => Promise<void>;
  refreshTasks: () => Promise<void>;
};

export function useTaskReadFlow({
  activeRepoPath,
  refreshBeadsCheckForRepo,
}: UseTaskReadFlowArgs): UseTaskReadFlowResult {
  const queryClient = useQueryClient();
  const [isManualLoadingTasks, setIsManualLoadingTasks] = useState(false);
  const manualRefreshTokenRef = useRef(0);
  const inFlightTaskRefreshRef = useRef<{ repoPath: string; promise: Promise<void> } | null>(null);
  const repoStoreHealthByRepoRef = useRef(new Map<string, RepoStoreHealth | null>());
  const lastTaskRefreshToastRef = useRef<{ repoPath: string; description: string } | null>(null);
  const lastTaskLoadErrorToastRef = useRef<{ repoPath: string; description: string } | null>(null);
  const currentWorkspaceRepoPathRef = useRef(activeRepoPath);
  const settingsSnapshotQuery = useQuery(settingsSnapshotQueryOptions());
  const settingsSnapshot = settingsSnapshotQuery.data ?? null;
  const doneVisibleDays = settingsSnapshot?.kanban.doneVisibleDays ?? null;
  const repoTaskDataQuery = useQuery({
    ...repoTaskDataQueryOptions(activeRepoPath ?? "__disabled__", doneVisibleDays ?? -1),
    enabled: activeRepoPath !== null && doneVisibleDays !== null,
  });

  useEffect(() => {
    const previousActiveRepoPath = currentWorkspaceRepoPathRef.current;
    currentWorkspaceRepoPathRef.current = activeRepoPath;
    if (previousActiveRepoPath !== activeRepoPath) {
      manualRefreshTokenRef.current += 1;
      setIsManualLoadingTasks(false);
      lastTaskRefreshToastRef.current = null;
      lastTaskLoadErrorToastRef.current = null;
    }
  }, [activeRepoPath]);

  useEffect(() => {
    let taskLoadError: unknown = null;
    if (settingsSnapshotQuery.isError) {
      taskLoadError = settingsSnapshotQuery.error;
    } else if (repoTaskDataQuery.isError) {
      taskLoadError = repoTaskDataQuery.error;
    }

    if (!taskLoadError || !activeRepoPath) {
      if (!taskLoadError) {
        lastTaskLoadErrorToastRef.current = null;
      }
      return;
    }

    const description = summarizeTaskLoadError({ error: taskLoadError });
    const lastToast = lastTaskLoadErrorToastRef.current;
    if (lastToast?.repoPath === activeRepoPath && lastToast.description === description) {
      return;
    }

    lastTaskLoadErrorToastRef.current = { repoPath: activeRepoPath, description };
    toast.error("Failed to load tasks", { description });
  }, [
    activeRepoPath,
    repoTaskDataQuery.error,
    repoTaskDataQuery.isError,
    settingsSnapshotQuery.error,
    settingsSnapshotQuery.isError,
  ]);

  const refreshTaskData = useCallback(
    async (repoPath: string, taskIdOrIds?: string | string[], options?: TaskDataRefreshOptions) => {
      const taskIds = toTaskIds(taskIdOrIds);
      if (options?.source === "external-sync") {
        await refreshRepoTaskViewsFromQuery(queryClient, repoPath, {
          forceFreshTaskList: true,
          ancillaryFailureMode: "best-effort",
          ignorePrimaryCancellation: true,
          refreshInactiveViews: false,
          ...(taskIds
            ? { taskDocumentStrategy: "invalidate", taskIds }
            : { taskDocumentStrategy: "none" }),
        });
        return;
      }

      await refreshRepoTaskViewsFromQuery(
        queryClient,
        repoPath,
        taskIds
          ? { taskDocumentStrategy: "refresh", taskIds }
          : {
              forceFreshTaskList: options?.forceFreshTaskList ?? true,
              taskDocumentStrategy: "none",
            },
      );
    },
    [queryClient],
  );

  const runRepoTaskRefresh = useCallback(
    async (repoPath: string): Promise<void> => {
      const beadsCheck = await refreshBeadsCheckForRepo(repoPath, false);
      repoStoreHealthByRepoRef.current.set(repoPath, getBlockingRepoStoreHealth(beadsCheck));
      await host.repoPullRequestSync(repoPath);
      await refreshTaskData(repoPath);
      try {
        const refreshedBeadsCheck = await refreshBeadsCheckForRepo(repoPath, true);
        repoStoreHealthByRepoRef.current.set(
          repoPath,
          getBlockingRepoStoreHealth(refreshedBeadsCheck),
        );
      } catch {
        // Keep refresh semantics unchanged when the follow-up diagnostics check fails.
      }
    },
    [refreshBeadsCheckForRepo, refreshTaskData],
  );

  const getRepoTaskRefreshPromise = useCallback(
    (repoPath: string): { promise: Promise<void>; joinedExisting: boolean } => {
      const inFlightRefresh = inFlightTaskRefreshRef.current;
      if (inFlightRefresh && inFlightRefresh.repoPath === repoPath) {
        return { promise: inFlightRefresh.promise, joinedExisting: true };
      }

      const promise = runRepoTaskRefresh(repoPath).finally(() => {
        if (inFlightTaskRefreshRef.current?.promise === promise) {
          inFlightTaskRefreshRef.current = null;
        }
      });
      inFlightTaskRefreshRef.current = { repoPath, promise };
      return { promise, joinedExisting: false };
    },
    [runRepoTaskRefresh],
  );

  const refreshTasksWithOptions = useCallback(
    async (options?: TaskRefreshOptions): Promise<void> => {
      if (!activeRepoPath) {
        return;
      }

      const repoPath = activeRepoPath;
      const trigger = options?.trigger ?? "manual";
      const manualRefreshToken = startManualRefresh(
        trigger,
        manualRefreshTokenRef,
        setIsManualLoadingTasks,
      );
      const { promise, joinedExisting } = getRepoTaskRefreshPromise(repoPath);

      try {
        await promise;
        lastTaskRefreshToastRef.current = null;
      } catch (error) {
        const description = summarizeTaskLoadError({
          error,
          repoStoreHealth: repoStoreHealthByRepoRef.current.get(repoPath) ?? null,
        });
        if (!joinedExisting) {
          console.warn(TASK_REFRESH_WARNING, {
            repoPath,
            trigger,
            description,
            error: errorMessage(error),
          });
        }
        maybeToastRefreshError({
          repoPath,
          description,
          trigger,
          joinedExisting,
          lastTaskRefreshToastRef,
        });
      } finally {
        finishManualRefresh(
          trigger,
          manualRefreshToken,
          manualRefreshTokenRef,
          setIsManualLoadingTasks,
        );
      }
    },
    [activeRepoPath, getRepoTaskRefreshPromise],
  );

  const refreshTasks = useCallback(async (): Promise<void> => {
    await refreshTasksWithOptions({ trigger: "manual" });
  }, [refreshTasksWithOptions]);

  const clearTaskReadState = useCallback(() => {
    manualRefreshTokenRef.current += 1;
    setIsManualLoadingTasks(false);
    lastTaskRefreshToastRef.current = null;
  }, []);

  const tasks =
    activeRepoPath && doneVisibleDays !== null ? (repoTaskDataQuery.data?.tasks ?? []) : [];
  const isSettingsLoadingForActiveRepo = activeRepoPath !== null && settingsSnapshotQuery.isPending;
  const isTaskQueryLoadingForActiveRepo =
    activeRepoPath !== null && doneVisibleDays !== null && repoTaskDataQuery.isPending;
  const isForegroundLoadingTasks =
    isManualLoadingTasks || isSettingsLoadingForActiveRepo || isTaskQueryLoadingForActiveRepo;
  const isRefreshingTasksInBackground =
    activeRepoPath !== null && repoTaskDataQuery.isFetching && !isForegroundLoadingTasks;

  return {
    tasks,
    isForegroundLoadingTasks,
    isRefreshingTasksInBackground,
    isLoadingTasks: isForegroundLoadingTasks,
    setIsLoadingTasks: setIsManualLoadingTasks,
    clearTaskReadState,
    refreshTaskData,
    refreshTasksWithOptions,
    refreshTasks,
  };
}

const toTaskIds = (taskIdOrIds?: string | string[]): string[] | null => {
  if (typeof taskIdOrIds === "string") {
    return [taskIdOrIds];
  }
  if (Array.isArray(taskIdOrIds)) {
    return taskIdOrIds;
  }
  return null;
};

const startManualRefresh = (
  trigger: TaskRefreshOptions["trigger"],
  tokenRef: MutableRefObject<number>,
  setIsManualLoading: (value: boolean) => void,
): number | null => {
  if (trigger !== "manual") {
    return null;
  }
  tokenRef.current += 1;
  setIsManualLoading(true);
  return tokenRef.current;
};

const finishManualRefresh = (
  trigger: TaskRefreshOptions["trigger"],
  token: number | null,
  tokenRef: MutableRefObject<number>,
  setIsManualLoading: (value: boolean) => void,
): void => {
  if (trigger === "manual" && token !== null && tokenRef.current === token) {
    setIsManualLoading(false);
  }
};

const maybeToastRefreshError = ({
  repoPath,
  description,
  trigger,
  joinedExisting,
  lastTaskRefreshToastRef,
}: {
  repoPath: string;
  description: string;
  trigger: TaskRefreshOptions["trigger"];
  joinedExisting: boolean;
  lastTaskRefreshToastRef: MutableRefObject<{ repoPath: string; description: string } | null>;
}): void => {
  const lastToast = lastTaskRefreshToastRef.current;
  const shouldDeduplicateToast =
    lastToast?.repoPath === repoPath &&
    lastToast.description === description &&
    (trigger === "scheduled" || joinedExisting);

  if (!shouldDeduplicateToast) {
    lastTaskRefreshToastRef.current = { repoPath, description };
    toast.error("Failed to refresh tasks", { description });
  }
};
