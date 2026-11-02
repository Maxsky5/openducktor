import type { WorkspaceRef } from "@openducktor/contracts";
import type { TaskRefreshOptions } from "../../app-state/app-state-contexts";
import type { ClientFeedback } from "../../platform/client-feedback";
import { summarizeTaskLoadError } from "../task-load-errors";

type TaskToastDedupeRef = {
  current: { workspaceId: string; repoPath: string; description: string } | null;
};

type CreateTaskRefreshControllerArgs = {
  setIsManualLoading: (value: boolean) => void;
  feedback: ClientFeedback;
  lastTaskRefreshToastRef: TaskToastDedupeRef;
  lastTaskLoadErrorToastRef: TaskToastDedupeRef;
};

type RefreshTasksArgs = WorkspaceRef & {
  trigger: TaskRefreshOptions["trigger"];
  refreshTaskData: (scope: WorkspaceRef) => Promise<void>;
};

export type TaskRefreshController = {
  refresh: (args: RefreshTasksArgs) => Promise<void>;
  resetManualLoading: () => void;
};

type InFlightTaskRefresh = {
  promise: Promise<void>;
  scope: WorkspaceRef;
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
    scope: WorkspaceRef,
    refreshTaskData: (scope: WorkspaceRef) => Promise<void>,
  ) => {
    if (
      inFlightRefresh?.scope.workspaceId === scope.workspaceId &&
      inFlightRefresh.scope.repoPath === scope.repoPath
    ) {
      return { promise: inFlightRefresh.promise, joinedExisting: true } satisfies {
        promise: Promise<void>;
        joinedExisting: boolean;
      };
    }

    const promise = refreshTaskData(scope).finally(() => {
      if (inFlightRefresh?.promise === promise) {
        inFlightRefresh = null;
      }
    });
    inFlightRefresh = { scope, promise };
    return { promise, joinedExisting: false } satisfies {
      promise: Promise<void>;
      joinedExisting: boolean;
    };
  };

  return {
    refresh: async ({ workspaceId, repoPath, trigger, refreshTaskData }): Promise<void> => {
      const isManualRefresh = trigger === "manual";
      const token = isManualRefresh ? ++manualRefreshToken : null;
      if (isManualRefresh) {
        setIsManualLoading(true);
      }

      const { promise, joinedExisting } = getRefreshPromise(
        { workspaceId, repoPath },
        refreshTaskData,
      );
      try {
        await promise;
        lastTaskRefreshToastRef.current = null;
      } catch (error) {
        const description = summarizeTaskLoadError({ error });
        lastTaskLoadErrorToastRef.current = { workspaceId, repoPath, description };
        const lastToast = lastTaskRefreshToastRef.current;
        const shouldDeduplicateToast =
          lastToast?.workspaceId === workspaceId &&
          lastToast.repoPath === repoPath &&
          lastToast.description === description &&
          (trigger === "scheduled" || joinedExisting);

        if (!shouldDeduplicateToast) {
          lastTaskRefreshToastRef.current = { workspaceId, repoPath, description };
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
