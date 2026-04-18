import {
  type BeadsCheck,
  externalTaskSyncEventSchema,
  type RepoStoreHealth,
  type RunEvent,
  runEventSchema,
} from "@openducktor/contracts";
import { type Dispatch, type SetStateAction, useEffect, useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
import { BROWSER_LIVE_STREAM_WARNING_EVENT_KIND } from "@/lib/browser-live/constants";
import { isBrowserLiveControlEvent } from "@/lib/browser-live-control-events";
import { errorMessage } from "@/lib/errors";
import { hostBridge } from "@/lib/host-client";
import { getBlockingRepoStoreHealth, summarizeTaskLoadError } from "@/state/tasks/task-load-errors";
import type { ActiveWorkspace } from "@/types/state-slices";
import { prependRunEvent } from "./app-lifecycle-model";

const BEADS_PREPARATION_TOAST_DELAY_MS = 1_000;
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
  setEvents: Dispatch<SetStateAction<RunEvent[]>>;
  setRunCompletionSignal: (runId: string, eventType: RunEvent["type"]) => void;
  refreshWorkspaces: () => Promise<void>;
  refreshBranches: (force?: boolean) => Promise<void>;
  refreshRuntimeCheck: (force?: boolean) => Promise<unknown>;
  refreshBeadsCheckForRepo: (repoPath: string, force?: boolean) => Promise<BeadsCheck>;
  refreshTaskData: (repoPath: string, taskIdOrIds?: string | string[]) => Promise<void>;
  clearBranchData: () => void;
  beadsPreparationToastDelayMs?: number;
};

export function useAppLifecycle({
  activeWorkspace,
  setEvents,
  setRunCompletionSignal,
  refreshWorkspaces,
  refreshBranches,
  refreshRuntimeCheck,
  refreshBeadsCheckForRepo,
  refreshTaskData,
  clearBranchData,
  beadsPreparationToastDelayMs = BEADS_PREPARATION_TOAST_DELAY_MS,
}: UseAppLifecycleArgs): void {
  const repoLoadVersionRef = useRef(0);
  const activeWorkspaceRef = useRef(activeWorkspace);
  const refreshTaskDataRef = useRef(refreshTaskData);
  const processedTaskEventIdsRef = useRef(new Set<string>());
  const processedTaskEventOrderRef = useRef<string[]>([]);

  useLayoutEffect(() => {
    activeWorkspaceRef.current = activeWorkspace;
    refreshTaskDataRef.current = refreshTaskData;
  }, [activeWorkspace, refreshTaskData]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | null = null;

    Promise.allSettled([refreshWorkspaces(), refreshRuntimeCheck(false)]).then(
      ([workspaceResult]) => {
        if (workspaceResult.status === "rejected") {
          toast.error("Workspace load failed", {
            description: errorMessage(workspaceResult.reason),
          });
        }
      },
    );

    hostBridge
      .subscribeRunEvents((payload) => {
        const parsed = runEventSchema.safeParse(payload);
        if (!parsed.success) {
          return;
        }

        setEvents((current) => prependRunEvent(current, parsed.data));
        if (
          parsed.data.type === "run_finished" ||
          parsed.data.type === "ready_for_manual_done_confirmation" ||
          parsed.data.type === "error"
        ) {
          setRunCompletionSignal(parsed.data.runId, parsed.data.type);
          const repoPath = activeWorkspaceRef.current?.repoPath ?? null;
          if (repoPath) {
            void refreshTaskDataRef.current(repoPath).catch((error: unknown) => {
              toast.error("Failed to refresh tasks", {
                description: summarizeTaskLoadError({ error }),
              });
            });
          }
        }
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
        toast.error("Run event subscription failed", {
          description: errorMessage(error),
        });
      });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [refreshRuntimeCheck, refreshWorkspaces, setEvents, setRunCompletionSignal]);

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

          void refreshTaskDataRef.current(activeRepoPath).catch((error: unknown) => {
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
            processedTaskEventIdsRef.current,
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

        void refreshTaskDataRef.current(parsed.data.repoPath, taskIds).catch((error: unknown) => {
          const title =
            parsed.data.kind === "tasks_updated"
              ? "Failed to sync task updates"
              : "Failed to sync external task changes";
          toast.error(title, {
            description: summarizeTaskLoadError({ error }),
          });
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
  }, []);

  useEffect(() => {
    const activeRepoPath = activeWorkspace?.repoPath ?? null;
    if (!activeRepoPath) {
      clearBranchData();
      return;
    }

    const loadVersion = ++repoLoadVersionRef.current;
    let beadsPreparationToastId: string | number | null = null;
    let beadsPreparationToastShown = false;
    let hadBeadsPreparationToast = false;
    let beadsPreparationTimer: ReturnType<typeof setTimeout> | null = null;

    const clearBeadsPreparationTimer = (): void => {
      if (beadsPreparationTimer !== null) {
        clearTimeout(beadsPreparationTimer);
        beadsPreparationTimer = null;
      }
    };

    const dismissBeadsPreparationToast = (): void => {
      if (beadsPreparationToastId !== null) {
        toast.dismiss(beadsPreparationToastId);
        beadsPreparationToastId = null;
      }
      beadsPreparationToastShown = false;
    };

    let repoStoreHealth: RepoStoreHealth | null = null;

    const taskLoadPromise = (async () => {
      beadsPreparationTimer = setTimeout(() => {
        if (
          repoLoadVersionRef.current !== loadVersion ||
          activeWorkspaceRef.current?.repoPath !== activeRepoPath
        ) {
          return;
        }
        beadsPreparationToastShown = true;
        hadBeadsPreparationToast = true;
        beadsPreparationToastId = toast.loading("Preparing Beads database", {
          description: "OpenDucktor is initializing the Beads task store for this repository.",
        });
      }, beadsPreparationToastDelayMs);

      try {
        const beadsCheck = await refreshBeadsCheckForRepo(activeRepoPath, false);
        repoStoreHealth = getBlockingRepoStoreHealth(beadsCheck);
        if (beadsCheck.repoStoreHealth.status !== "initializing") {
          clearBeadsPreparationTimer();
          if (beadsPreparationToastShown) {
            dismissBeadsPreparationToast();
          }
        }

        await refreshTaskData(activeRepoPath);
        if (!beadsCheck.repoStoreHealth.isReady) {
          try {
            const refreshedBeadsCheck = await refreshBeadsCheckForRepo(activeRepoPath, true);
            repoStoreHealth = getBlockingRepoStoreHealth(refreshedBeadsCheck);
          } catch {
            // Preserve the main repo-load outcome if the follow-up diagnostics refresh fails.
          }
        }

        if (
          !repoStoreHealth &&
          hadBeadsPreparationToast &&
          repoLoadVersionRef.current === loadVersion &&
          activeWorkspaceRef.current?.repoPath === activeRepoPath
        ) {
          dismissBeadsPreparationToast();
          toast.success("Beads database ready", {
            description: "The task store is ready for this repository.",
          });
        }
      } finally {
        clearBeadsPreparationTimer();
        dismissBeadsPreparationToast();
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

        if (tasksResult.status === "rejected") {
          toast.error("Repository tasks unavailable", {
            description: summarizeTaskLoadError({ error: tasksResult.reason, repoStoreHealth }),
          });
        }
      })
      .finally(() => {
        if (repoLoadVersionRef.current !== loadVersion) {
          return;
        }
      });

    return () => {
      clearBeadsPreparationTimer();
      dismissBeadsPreparationToast();
    };
  }, [
    activeWorkspace,
    beadsPreparationToastDelayMs,
    clearBranchData,
    refreshBeadsCheckForRepo,
    refreshBranches,
    refreshRuntimeCheck,
    refreshTaskData,
  ]);
}
