import type { TaskRefreshOptions } from "@/state/app-state-contexts";
import { summarizeTaskLoadError } from "@/state/tasks/task-load-errors";

type TaskToastDedupeRef = {
  current: { repoPath: string; description: string } | null;
};

type TaskRefreshNotificationPort = {
  error: (title: string, options: { description: string }) => void;
};

type CreateTaskRefreshControllerArgs = {
  setIsManualLoading: (value: boolean) => void;
  notificationPort: TaskRefreshNotificationPort;
  lastTaskRefreshToastRef: TaskToastDedupeRef;
  lastTaskLoadErrorToastRef: TaskToastDedupeRef;
};

type RefreshTasksArgs = {
  repoPath: string;
  trigger: TaskRefreshOptions["trigger"];
  refreshTaskData: (repoPath: string) => Promise<void>;
};

export type TaskRefreshController = {
  refresh: (args: RefreshTasksArgs) => Promise<void>;
  resetManualLoading: () => void;
};

export const createTaskRefreshController = ({
  setIsManualLoading,
  notificationPort,
  lastTaskRefreshToastRef,
  lastTaskLoadErrorToastRef,
}: CreateTaskRefreshControllerArgs): TaskRefreshController => {
  let manualRefreshToken = 0;
  let inFlightRefresh: { repoPath: string; promise: Promise<void> } | null = null;

  const getRefreshPromise = (
    repoPath: string,
    refreshTaskData: (repoPath: string) => Promise<void>,
  ): { promise: Promise<void>; joinedExisting: boolean } => {
    if (inFlightRefresh?.repoPath === repoPath) {
      return { promise: inFlightRefresh.promise, joinedExisting: true };
    }

    const promise = refreshTaskData(repoPath).finally(() => {
      if (inFlightRefresh?.promise === promise) {
        inFlightRefresh = null;
      }
    });
    inFlightRefresh = { repoPath, promise };
    return { promise, joinedExisting: false };
  };

  return {
    refresh: async ({ repoPath, trigger, refreshTaskData }): Promise<void> => {
      const isManualRefresh = trigger === "manual";
      const token = isManualRefresh ? ++manualRefreshToken : null;
      if (isManualRefresh) {
        setIsManualLoading(true);
      }

      const { promise, joinedExisting } = getRefreshPromise(repoPath, refreshTaskData);
      try {
        await promise;
        lastTaskRefreshToastRef.current = null;
      } catch (error) {
        const description = summarizeTaskLoadError({ error });
        lastTaskLoadErrorToastRef.current = { repoPath, description };
        const lastToast = lastTaskRefreshToastRef.current;
        const shouldDeduplicateToast =
          lastToast?.repoPath === repoPath &&
          lastToast.description === description &&
          (trigger === "scheduled" || joinedExisting);

        if (!shouldDeduplicateToast) {
          lastTaskRefreshToastRef.current = { repoPath, description };
          notificationPort.error("Failed to refresh tasks", { description });
        }
      } finally {
        if (token !== null && manualRefreshToken === token) {
          setIsManualLoading(false);
        }
      }
    },
    resetManualLoading: (): void => {
      manualRefreshToken += 1;
      setIsManualLoading(false);
    },
  };
};
