import { type RunEvent, runEventSchema } from "@openducktor/contracts";
import { type Dispatch, type SetStateAction, useEffect, useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { hostBridge } from "@/lib/host-client";
import type { TaskRefreshOptions } from "@/state/app-state-contexts";
import { summarizeTaskLoadError } from "@/state/tasks/task-load-errors";
import { prependRunEvent } from "./app-lifecycle-model";

const BEADS_PREPARATION_TOAST_DELAY_MS = 1_000;
const PULL_REQUEST_SYNC_INTERVAL_MS = 5 * 60 * 1_000;

type UseAppLifecycleArgs = {
  activeRepo: string | null;
  setEvents: Dispatch<SetStateAction<RunEvent[]>>;
  setRunCompletionSignal: (runId: string, eventType: RunEvent["type"]) => void;
  refreshWorkspaces: () => Promise<void>;
  refreshBranches: (force?: boolean) => Promise<void>;
  refreshRuntimeCheck: (force?: boolean) => Promise<unknown>;
  refreshBeadsCheckForRepo: (
    repoPath: string,
    force?: boolean,
  ) => Promise<{
    beadsOk: boolean;
    beadsError?: string | null;
  }>;
  refreshTaskData: (repoPath: string, taskId?: string) => Promise<void>;
  refreshTasksWithOptions: (options?: TaskRefreshOptions) => Promise<void>;
  clearBranchData: () => void;
  beadsPreparationToastDelayMs?: number;
  pullRequestSyncIntervalMs?: number;
};

export function useAppLifecycle({
  activeRepo,
  setEvents,
  setRunCompletionSignal,
  refreshWorkspaces,
  refreshBranches,
  refreshRuntimeCheck,
  refreshBeadsCheckForRepo,
  refreshTaskData,
  refreshTasksWithOptions,
  clearBranchData,
  beadsPreparationToastDelayMs = BEADS_PREPARATION_TOAST_DELAY_MS,
  pullRequestSyncIntervalMs = PULL_REQUEST_SYNC_INTERVAL_MS,
}: UseAppLifecycleArgs): void {
  const repoLoadVersionRef = useRef(0);
  const activeRepoRef = useRef(activeRepo);
  const refreshTaskDataRef = useRef(refreshTaskData);
  const refreshTasksWithOptionsRef = useRef(refreshTasksWithOptions);

  useLayoutEffect(() => {
    activeRepoRef.current = activeRepo;
    refreshTaskDataRef.current = refreshTaskData;
    refreshTasksWithOptionsRef.current = refreshTasksWithOptions;
  }, [activeRepo, refreshTaskData, refreshTasksWithOptions]);

  useEffect(() => {
    Promise.allSettled([refreshWorkspaces(), refreshRuntimeCheck(false)]).then(
      ([workspaceResult]) => {
        if (workspaceResult.status === "rejected") {
          toast.error("Workspace load failed", {
            description: errorMessage(workspaceResult.reason),
          });
        }
      },
    );

    let unsubscribe: (() => void) | null = null;
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
          const repoPath = activeRepoRef.current;
          if (repoPath) {
            void refreshTaskDataRef.current(repoPath).catch((error: unknown) => {
              toast.error("Failed to refresh tasks", {
                description: summarizeTaskLoadError(error),
              });
            });
          }
        }
      })
      .then((cleanup) => {
        unsubscribe = cleanup;
      })
      .catch((error: unknown) => {
        toast.error("Run event subscription failed", {
          description: errorMessage(error),
        });
      });

    return () => {
      unsubscribe?.();
    };
  }, [refreshRuntimeCheck, refreshWorkspaces, setEvents, setRunCompletionSignal]);

  useEffect(() => {
    if (!activeRepo) {
      clearBranchData();
      return;
    }

    const loadVersion = ++repoLoadVersionRef.current;
    let beadsPreparationToastId: string | number | null = null;
    let beadsPreparationToastShown = false;
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

    const taskLoadPromise = (async () => {
      beadsPreparationTimer = setTimeout(() => {
        if (repoLoadVersionRef.current !== loadVersion || activeRepoRef.current !== activeRepo) {
          return;
        }
        beadsPreparationToastShown = true;
        beadsPreparationToastId = toast.loading("Preparing Beads database", {
          description: "OpenDucktor is initializing the Beads task store for this repository.",
        });
      }, beadsPreparationToastDelayMs);

      try {
        const beads = await refreshBeadsCheckForRepo(activeRepo, false);
        clearBeadsPreparationTimer();

        if (!beads.beadsOk) {
          throw new Error(
            beads.beadsError ?? "Beads store is not initialized for this repository.",
          );
        }

        if (
          beadsPreparationToastShown &&
          repoLoadVersionRef.current === loadVersion &&
          activeRepoRef.current === activeRepo
        ) {
          dismissBeadsPreparationToast();
          toast.success("Beads database ready", {
            description: "The task store is ready for this repository.",
          });
        }

        await refreshTaskData(activeRepo);
      } finally {
        clearBeadsPreparationTimer();
        dismissBeadsPreparationToast();
      }
    })();
    const runtimeCheckPromise = refreshRuntimeCheck(false);
    const isStaleRepoLoad = (): boolean =>
      repoLoadVersionRef.current !== loadVersion || activeRepoRef.current !== activeRepo;

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
            description: summarizeTaskLoadError(tasksResult.reason),
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
    activeRepo,
    beadsPreparationToastDelayMs,
    clearBranchData,
    refreshBeadsCheckForRepo,
    refreshBranches,
    refreshRuntimeCheck,
    refreshTaskData,
  ]);

  useEffect(() => {
    if (!activeRepo || typeof document === "undefined") {
      return;
    }

    let pullRequestSyncIntervalId: ReturnType<typeof setInterval> | null = null;

    const clearPullRequestSyncInterval = (): void => {
      if (pullRequestSyncIntervalId !== null) {
        clearInterval(pullRequestSyncIntervalId);
        pullRequestSyncIntervalId = null;
      }
    };

    const restartPullRequestSyncInterval = (): void => {
      clearPullRequestSyncInterval();
      if (document.visibilityState !== "visible") {
        return;
      }

      pullRequestSyncIntervalId = setInterval(() => {
        void refreshTasksWithOptionsRef.current({ trigger: "scheduled" });
      }, pullRequestSyncIntervalMs);
    };

    const handleVisibilityChange = (): void => {
      restartPullRequestSyncInterval();
    };

    restartPullRequestSyncInterval();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearPullRequestSyncInterval();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeRepo, pullRequestSyncIntervalMs]);
}
