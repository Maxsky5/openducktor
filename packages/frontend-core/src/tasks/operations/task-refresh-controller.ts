import type { TaskRefreshOptions } from "../../app-state/app-state-contexts";
import type { ClientFeedback } from "../../platform/client-feedback";
import { summarizeTaskLoadError } from "../task-load-errors";

type TaskToastDedupeRef = {
  current: { repoPath: string; description: string } | null;
};

type CreateTaskRefreshControllerArgs = {
  setIsManualLoading: (value: boolean) => void;
  feedback: ClientFeedback;
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

type InFlightTaskRefresh = {
  promise: Promise<void>;
  repoPath: string;
};

export const createTaskRefreshController = ({
  setIsManualLoading,
  feedback,
  lastTaskRefreshToastRef,
  lastTaskLoadErrorToastRef,
}: CreateTaskRefreshControllerArgs): TaskRefreshController => {
  let manualRefreshToken = 0;
  let inFlightRefresh: InFlightTaskRefresh | null = null;

  const getRefreshPromise = (
    repoPath: string,
    refreshTaskData: (repoPath: string) => Promise<void>,
  ) => {
    if (inFlightRefresh?.repoPath === repoPath) {
      return { promise: inFlightRefresh.promise, joinedExisting: true } satisfies {
        promise: Promise<void>;
        joinedExisting: boolean;
      };
    }

    const promise = refreshTaskData(repoPath).finally(() => {
      if (inFlightRefresh?.promise === promise) {
        inFlightRefresh = null;
      }
    });
    inFlightRefresh = { repoPath, promise };
    return { promise, joinedExisting: false } satisfies {
      promise: Promise<void>;
      joinedExisting: boolean;
    };
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
          feedback.show("error", "Failed to refresh tasks", { description });
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
