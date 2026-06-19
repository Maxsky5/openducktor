import {
  externalTaskSyncEventSchema,
  type RepoStoreHealth,
  type TaskStoreCheck,
} from "@openducktor/contracts";
import { CancelledError } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
import { BROWSER_LIVE_STREAM_WARNING_EVENT_KIND } from "@/lib/browser-live/constants";
import { isBrowserLiveControlEvent } from "@/lib/browser-live-control-events";
import { errorMessage } from "@/lib/errors";
import { hostBridge } from "@/lib/host-client";
import type { TaskDataRefreshOptions } from "@/state/app-state-contexts";
import { getBlockingRepoStoreHealth, summarizeTaskLoadError } from "@/state/tasks/task-load-errors";
import type { ActiveWorkspace } from "@/types/state-slices";

const TASK_STORE_PREPARATION_TOAST_DELAY_MS = 1_000;
const MAX_TRACKED_EXTERNAL_TASK_EVENT_IDS = 256;

const rememberProcessedExternalTaskEvent = (
  eventIds: Set<string>,
  order: string[],
  eventId: string,
): boolean => {
  if (eventIds.has(eventId)) {
    return false;
  }

  eventIds.add(eventId);
  order.push(eventId);
  if (order.length > MAX_TRACKED_EXTERNAL_TASK_EVENT_IDS) {
    const oldestEventId = order.shift();
    if (oldestEventId) {
      eventIds.delete(oldestEventId);
    }
  }

  return true;
};

type UseAppLifecycleArgs = {
  activeWorkspace: ActiveWorkspace | null;
  refreshBranches: (force?: boolean) => Promise<void>;
  refreshRuntimeCheck: (force?: boolean) => Promise<unknown>;
  refreshTaskStoreCheckForRepo: (repoPath: string, force?: boolean) => Promise<TaskStoreCheck>;
  refreshTaskData: (
    repoPath: string,
    taskIdOrIds?: string | string[],
    options?: TaskDataRefreshOptions,
  ) => Promise<void>;
  clearBranchData: () => void;
  taskStorePreparationToastDelayMs?: number;
};

export function useAppLifecycle({
  activeWorkspace,
  refreshBranches,
  refreshRuntimeCheck,
  refreshTaskStoreCheckForRepo,
  refreshTaskData,
  clearBranchData,
  taskStorePreparationToastDelayMs = TASK_STORE_PREPARATION_TOAST_DELAY_MS,
}: UseAppLifecycleArgs): void {
  const repoLoadVersionRef = useRef(0);
  const activeWorkspaceRef = useRef(activeWorkspace);
  const refreshTaskDataRef = useRef(refreshTaskData);
  const processedTaskEventIdsRef = useRef<Set<string> | null>(null);
  if (processedTaskEventIdsRef.current === null) {
    processedTaskEventIdsRef.current = new Set<string>();
  }
  const processedTaskEventIds = processedTaskEventIdsRef.current;
  const processedTaskEventOrderRef = useRef<string[]>([]);
  const lastExternalTaskSyncFailureToastRef = useRef<{
    repoPath: string;
    title: string;
    description: string;
  } | null>(null);

  useLayoutEffect(() => {
    const previousRepoPath = activeWorkspaceRef.current?.repoPath ?? null;
    const nextRepoPath = activeWorkspace?.repoPath ?? null;
    if (previousRepoPath !== nextRepoPath) {
      lastExternalTaskSyncFailureToastRef.current = null;
    }
    activeWorkspaceRef.current = activeWorkspace;
    refreshTaskDataRef.current = refreshTaskData;
  }, [activeWorkspace, refreshTaskData]);

  useEffect(() => {
    void refreshRuntimeCheck(false);
  }, [refreshRuntimeCheck]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    hostBridge
      .subscribeTaskEvents((payload) => {
        if (isBrowserLiveControlEvent(payload)) {
          const activeRepoPath = activeWorkspaceRef.current?.repoPath ?? null;
          if (!activeRepoPath) {
            return;
          }

          if (payload.kind === BROWSER_LIVE_STREAM_WARNING_EVENT_KIND) {
            toast.error("Task sync stream degraded", {
              description:
                payload.message ??
                "The browser-live task event stream fell behind and is reconnecting.",
            });
          }

          void refreshTaskDataRef
            .current(activeRepoPath, undefined, { source: "external-sync" })
            .catch((error: unknown) => {
              toast.error("Failed to resync tasks after task stream reconnect", {
                description: summarizeTaskLoadError({ error }),
              });
            });
          return;
        }

        const parsed = externalTaskSyncEventSchema.safeParse(payload);
        if (!parsed.success) {
          toast.error("Task sync event invalid", {
            description: "Received an invalid external task sync payload from the host bridge.",
          });
          return;
        }

        if (
          !rememberProcessedExternalTaskEvent(
            processedTaskEventIds,
            processedTaskEventOrderRef.current,
            parsed.data.eventId,
          )
        ) {
          return;
        }

        if (activeWorkspaceRef.current?.repoPath !== parsed.data.repoPath) {
          return;
        }

        const taskIds =
          parsed.data.kind === "tasks_updated" ? parsed.data.taskIds : parsed.data.taskId;

        void refreshTaskDataRef
          .current(parsed.data.repoPath, taskIds, { source: "external-sync" })
          .then(() => {
            if (lastExternalTaskSyncFailureToastRef.current?.repoPath === parsed.data.repoPath) {
              lastExternalTaskSyncFailureToastRef.current = null;
            }
          })
          .catch((error: unknown) => {
            const title =
              parsed.data.kind === "tasks_updated"
                ? "Failed to sync task updates"
                : "Failed to sync external task changes";
            const description = summarizeTaskLoadError({ error });
            const lastToast = lastExternalTaskSyncFailureToastRef.current;
            if (
              lastToast?.repoPath === parsed.data.repoPath &&
              lastToast.title === title &&
              lastToast.description === description
            ) {
              return;
            }

            lastExternalTaskSyncFailureToastRef.current = {
              repoPath: parsed.data.repoPath,
              title,
              description,
            };
            toast.error(title, { description });
          });
      })
      .then((cleanup) => {
        if (disposed) {
          cleanup();
          return;
        }
        unsubscribe = cleanup;
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        toast.error("Task event subscription failed", {
          description: errorMessage(error),
        });
      });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [processedTaskEventIds]);

  useEffect(() => {
    const activeRepoPath = activeWorkspace?.repoPath ?? null;
    if (!activeRepoPath) {
      clearBranchData();
      return;
    }

    const loadVersion = ++repoLoadVersionRef.current;
    let taskStorePreparationToastId: string | number | null = null;
    let taskStorePreparationToastShown = false;
    let hadTaskStorePreparationToast = false;
    let taskStorePreparationTimer: ReturnType<typeof setTimeout> | null = null;

    const clearTaskStorePreparationTimer = (): void => {
      if (taskStorePreparationTimer !== null) {
        clearTimeout(taskStorePreparationTimer);
        taskStorePreparationTimer = null;
      }
    };

    const dismissTaskStorePreparationToast = (): void => {
      if (taskStorePreparationToastId !== null) {
        toast.dismiss(taskStorePreparationToastId);
        taskStorePreparationToastId = null;
      }
      taskStorePreparationToastShown = false;
    };

    let repoStoreHealth: RepoStoreHealth | null = null;

    const taskLoadPromise = (async () => {
      taskStorePreparationTimer = setTimeout(() => {
        if (
          repoLoadVersionRef.current !== loadVersion ||
          activeWorkspaceRef.current?.repoPath !== activeRepoPath
        ) {
          return;
        }
        taskStorePreparationToastShown = true;
        hadTaskStorePreparationToast = true;
        taskStorePreparationToastId = toast.loading("Preparing task store", {
          description: "OpenDucktor is opening the SQLite task store for this repository.",
        });
      }, taskStorePreparationToastDelayMs);

      try {
        const taskStoreCheck = await refreshTaskStoreCheckForRepo(activeRepoPath, false);
        repoStoreHealth = getBlockingRepoStoreHealth(taskStoreCheck);
        if (taskStoreCheck.repoStoreHealth.isReady) {
          clearTaskStorePreparationTimer();
          if (taskStorePreparationToastShown) {
            dismissTaskStorePreparationToast();
          }
        }

        let taskLoadFailed = false;
        let taskLoadError: unknown;
        try {
          // Initial repo load may use warm task data while the task store finishes preparing; manual
          // refresh and mutation paths remain strict and force fresh task reads.
          await refreshTaskData(activeRepoPath, undefined, { forceFreshTaskList: false });
        } catch (error) {
          taskLoadFailed = true;
          taskLoadError = error;
        }

        if (!taskStoreCheck.repoStoreHealth.isReady) {
          try {
            const refreshedTaskStoreCheck = await refreshTaskStoreCheckForRepo(
              activeRepoPath,
              true,
            );
            repoStoreHealth = getBlockingRepoStoreHealth(refreshedTaskStoreCheck);
          } catch {
            // Preserve the main repo-load outcome if the follow-up diagnostics refresh fails.
          }
        }

        if (taskLoadFailed) {
          throw taskLoadError;
        }

        if (
          !repoStoreHealth &&
          hadTaskStorePreparationToast &&
          repoLoadVersionRef.current === loadVersion &&
          activeWorkspaceRef.current?.repoPath === activeRepoPath
        ) {
          dismissTaskStorePreparationToast();
          toast.success("task store ready", {
            description: "The task store is ready for this repository.",
          });
        }
      } finally {
        clearTaskStorePreparationTimer();
        dismissTaskStorePreparationToast();
      }
    })();
    const runtimeCheckPromise = refreshRuntimeCheck(false);
    const isStaleRepoLoad = (): boolean =>
      repoLoadVersionRef.current !== loadVersion ||
      activeWorkspaceRef.current?.repoPath !== activeRepoPath;

    void refreshBranches(false).catch((error: unknown) => {
      if (isStaleRepoLoad()) {
        return;
      }
      toast.error("Repository branches unavailable", {
        description: errorMessage(error),
      });
    });

    Promise.allSettled([taskLoadPromise, runtimeCheckPromise])
      .then(([tasksResult]) => {
        if (isStaleRepoLoad()) {
          return;
        }

        if (tasksResult.status === "rejected" && !(tasksResult.reason instanceof CancelledError)) {
          toast.error("Repository tasks unavailable", {
            description: summarizeTaskLoadError({
              error: tasksResult.reason,
              repoStoreHealth,
            }),
          });
        }
      })
      .finally(() => {
        if (repoLoadVersionRef.current !== loadVersion) {
          return;
        }
      });

    return () => {
      if (taskStorePreparationTimer !== null) {
        clearTimeout(taskStorePreparationTimer);
        taskStorePreparationTimer = null;
      }
      dismissTaskStorePreparationToast();
    };
  }, [
    activeWorkspace,
    taskStorePreparationToastDelayMs,
    clearBranchData,
    refreshTaskStoreCheckForRepo,
    refreshBranches,
    refreshRuntimeCheck,
    refreshTaskData,
  ]);
}
