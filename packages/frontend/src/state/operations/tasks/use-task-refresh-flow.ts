import type { BeadsCheck, RepoStoreHealth } from "@openducktor/contracts";
import { type MutableRefObject, useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import type { TaskRefreshOptions } from "@/state/app-state-contexts";
import { getBlockingRepoStoreHealth, summarizeTaskLoadError } from "@/state/tasks/task-load-errors";
import { host } from "../shared/host";
import type { UseTaskReadFlowResult } from "./use-task-read-flow";

const TASK_REFRESH_WARNING = "Pull request sync failed during task refresh";

type UseTaskRefreshFlowArgs = {
  activeRepoPath: string | null;
  refreshBeadsCheckForRepo: (repoPath: string, force?: boolean) => Promise<BeadsCheck>;
  refreshTaskData: UseTaskReadFlowResult["refreshTaskData"];
  lastTaskRefreshToastRef: MutableRefObject<{ repoPath: string; description: string } | null>;
};

export type TaskRefreshFlow = {
  isManualLoadingTasks: boolean;
  setIsLoadingTasks: (value: boolean) => void;
  resetManualLoading: () => void;
  refreshTasksWithOptions: (options?: TaskRefreshOptions) => Promise<void>;
  refreshTasks: () => Promise<void>;
};

export function useTaskRefreshFlow({
  activeRepoPath,
  refreshBeadsCheckForRepo,
  refreshTaskData,
  lastTaskRefreshToastRef,
}: UseTaskRefreshFlowArgs): TaskRefreshFlow {
  const [isManualLoadingTasks, setIsManualLoadingTasks] = useState(false);
  const manualRefreshTokenRef = useRef(0);
  const inFlightTaskRefreshRef = useRef<{ repoPath: string; promise: Promise<void> } | null>(null);
  const repoStoreHealthByRepoRef = useRef(new Map<string, RepoStoreHealth | null>());

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
    [activeRepoPath, getRepoTaskRefreshPromise, lastTaskRefreshToastRef],
  );

  const refreshTasks = useCallback(async (): Promise<void> => {
    await refreshTasksWithOptions({ trigger: "manual" });
  }, [refreshTasksWithOptions]);

  const resetManualLoading = useCallback(() => {
    manualRefreshTokenRef.current += 1;
    setIsManualLoadingTasks(false);
  }, []);

  return {
    isManualLoadingTasks,
    setIsLoadingTasks: setIsManualLoadingTasks,
    resetManualLoading,
    refreshTasksWithOptions,
    refreshTasks,
  };
}

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
