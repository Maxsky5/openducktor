import { type RunEvent, type RuntimeKind, runEventSchema } from "@openducktor/contracts";
import { type Dispatch, type SetStateAction, useEffect, useRef } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { subscribeRunEvents } from "@/lib/host-client";
import { appQueryClient } from "@/lib/query-client";
import { invalidateRepoTaskQueries } from "@/state/queries/tasks";
import { summarizeTaskLoadError } from "@/state/tasks/task-load-errors";
import type { RepoRuntimeHealthMap } from "@/types/diagnostics";
import { prependRunEvent, shouldLoadChecks } from "./app-lifecycle-model";

const BEADS_PREPARATION_TOAST_DELAY_MS = 1_000;

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
  refreshRepoRuntimeHealthForRepo: (
    repoPath: string,
    force?: boolean,
  ) => Promise<RepoRuntimeHealthMap>;
  runtimeKinds: RuntimeKind[];
  refreshTaskData: (repoPath: string) => Promise<void>;
  clearTaskData: () => void;
  clearBranchData: () => void;
  clearActiveBeadsCheck: () => void;
  clearActiveRepoRuntimeHealth: () => void;
  setIsLoadingTasks: (value: boolean) => void;
  setIsLoadingChecks: (value: boolean) => void;
  hasRuntimeCheck: () => boolean;
  hasCachedBeadsCheck: (repoPath: string) => boolean;
  hasCachedRepoRuntimeHealth: (repoPath: string, runtimeKinds: RuntimeKind[]) => boolean;
  beadsPreparationToastDelayMs?: number;
};

export function useAppLifecycle({
  activeRepo,
  setEvents,
  setRunCompletionSignal,
  refreshWorkspaces,
  refreshBranches,
  refreshRuntimeCheck,
  refreshBeadsCheckForRepo,
  refreshRepoRuntimeHealthForRepo,
  runtimeKinds,
  refreshTaskData,
  clearTaskData,
  clearBranchData,
  clearActiveBeadsCheck,
  clearActiveRepoRuntimeHealth,
  setIsLoadingTasks,
  setIsLoadingChecks,
  hasRuntimeCheck,
  hasCachedBeadsCheck,
  hasCachedRepoRuntimeHealth,
  beadsPreparationToastDelayMs = BEADS_PREPARATION_TOAST_DELAY_MS,
}: UseAppLifecycleArgs): void {
  const repoLoadVersionRef = useRef(0);
  const activeRepoRef = useRef(activeRepo);
  const refreshTaskDataRef = useRef(refreshTaskData);

  useEffect(() => {
    activeRepoRef.current = activeRepo;
    refreshTaskDataRef.current = refreshTaskData;
  }, [activeRepo, refreshTaskData]);

  useEffect(() => {
    Promise.allSettled([refreshWorkspaces(), refreshRuntimeCheck(false)]).then(
      ([workspaceResult, runtimeResult]) => {
        if (workspaceResult.status === "rejected") {
          toast.error("Workspace load failed", {
            description: errorMessage(workspaceResult.reason),
          });
        }

        if (runtimeResult.status === "rejected") {
          toast.error("Runtime checks unavailable", {
            description: errorMessage(runtimeResult.reason),
          });
        }
      },
    );

    let unsubscribe: (() => void) | null = null;
    subscribeRunEvents((payload) => {
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
          void invalidateRepoTaskQueries(appQueryClient, repoPath)
            .then(() => refreshTaskDataRef.current(repoPath))
            .catch((error: unknown) => {
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
      clearTaskData();
      clearBranchData();
      clearActiveBeadsCheck();
      clearActiveRepoRuntimeHealth();
      setIsLoadingTasks(false);
      setIsLoadingChecks(false);
      return;
    }

    const loadVersion = ++repoLoadVersionRef.current;
    setIsLoadingTasks(true);
    setIsLoadingChecks(
      shouldLoadChecks({
        hasRuntimeCheck: hasRuntimeCheck(),
        hasCachedBeadsCheck: hasCachedBeadsCheck(activeRepo),
        hasCachedRepoRuntimeHealth: hasCachedRepoRuntimeHealth(activeRepo, runtimeKinds),
      }),
    );
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
    const runtimeHealthPromise = refreshRepoRuntimeHealthForRepo(activeRepo, false);
    const branchesPromise = refreshBranches(false);

    const finalizeTaskLoading = (): void => {
      if (repoLoadVersionRef.current !== loadVersion) {
        return;
      }

      setIsLoadingTasks(false);
    };

    void taskLoadPromise.then(finalizeTaskLoading, finalizeTaskLoading);

    Promise.allSettled([
      taskLoadPromise,
      runtimeCheckPromise,
      runtimeHealthPromise,
      branchesPromise,
    ])
      .then(([tasksResult, runtimeResult, runtimeHealthResult, branchesResult]) => {
        if (repoLoadVersionRef.current !== loadVersion) {
          return;
        }

        if (tasksResult.status === "rejected") {
          toast.error("Repository tasks unavailable", {
            description: summarizeTaskLoadError(tasksResult.reason),
          });
        }

        if (runtimeResult.status === "rejected") {
          toast.error("Runtime checks unavailable", {
            description: errorMessage(runtimeResult.reason),
          });
        }

        if (runtimeHealthResult.status === "rejected") {
          toast.error("Runtime + MCP diagnostics unavailable", {
            description: errorMessage(runtimeHealthResult.reason),
          });
        } else {
          const runtimeHealthEntries = Object.values(runtimeHealthResult.value);
          const hasRuntimeIssue = runtimeHealthEntries.some(
            (entry) => entry && (!entry.runtimeOk || !entry.mcpOk),
          );
          if (hasRuntimeIssue) {
            toast.error("Runtime + MCP unavailable", {
              description:
                runtimeHealthEntries.flatMap((entry) => entry?.errors ?? []).join(" | ") ||
                "The selected runtime or OpenDucktor MCP is not ready.",
            });
          }
        }

        if (branchesResult.status === "rejected") {
          toast.error("Repository branches unavailable", {
            description: errorMessage(branchesResult.reason),
          });
        }
      })
      .finally(() => {
        if (repoLoadVersionRef.current !== loadVersion) {
          return;
        }

        setIsLoadingChecks(false);
      });

    return () => {
      clearBeadsPreparationTimer();
      dismissBeadsPreparationToast();
    };
  }, [
    activeRepo,
    beadsPreparationToastDelayMs,
    clearBranchData,
    clearActiveBeadsCheck,
    clearActiveRepoRuntimeHealth,
    clearTaskData,
    hasCachedBeadsCheck,
    hasCachedRepoRuntimeHealth,
    hasRuntimeCheck,
    runtimeKinds,
    refreshBeadsCheckForRepo,
    refreshBranches,
    refreshRepoRuntimeHealthForRepo,
    refreshRuntimeCheck,
    refreshTaskData,
    setIsLoadingChecks,
    setIsLoadingTasks,
  ]);
}
