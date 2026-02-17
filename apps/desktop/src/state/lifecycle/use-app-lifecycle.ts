import { errorMessage } from "@/lib/errors";
import { subscribeRunEvents } from "@/lib/host-client";
import { summarizeTaskLoadError } from "@/state/tasks/task-load-errors";
import { type RunEvent, runEventSchema } from "@openblueprint/contracts";
import { type Dispatch, type SetStateAction, useEffect, useRef } from "react";
import { toast } from "sonner";

type UseAppLifecycleArgs = {
  activeRepo: string | null;
  setEvents: Dispatch<SetStateAction<RunEvent[]>>;
  refreshWorkspaces: () => Promise<void>;
  refreshRuntimeCheck: (force?: boolean) => Promise<unknown>;
  refreshBeadsCheckForRepo: (
    repoPath: string,
    force?: boolean,
  ) => Promise<{
    beadsOk: boolean;
    beadsError?: string | null;
  }>;
  refreshTaskData: (repoPath: string) => Promise<void>;
  clearTaskData: () => void;
  clearActiveBeadsCheck: () => void;
  setIsLoadingTasks: (value: boolean) => void;
  setIsLoadingChecks: (value: boolean) => void;
  hasRuntimeCheck: () => boolean;
  hasCachedBeadsCheck: (repoPath: string) => boolean;
};

export function useAppLifecycle({
  activeRepo,
  setEvents,
  refreshWorkspaces,
  refreshRuntimeCheck,
  refreshBeadsCheckForRepo,
  refreshTaskData,
  clearTaskData,
  clearActiveBeadsCheck,
  setIsLoadingTasks,
  setIsLoadingChecks,
  hasRuntimeCheck,
  hasCachedBeadsCheck,
}: UseAppLifecycleArgs): void {
  const repoLoadVersionRef = useRef(0);

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

      setEvents((current) => [parsed.data, ...current].slice(0, 500));
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
  }, [refreshRuntimeCheck, refreshWorkspaces, setEvents]);

  useEffect(() => {
    if (!activeRepo) {
      clearTaskData();
      clearActiveBeadsCheck();
      setIsLoadingTasks(false);
      setIsLoadingChecks(false);
      return;
    }

    const loadVersion = ++repoLoadVersionRef.current;
    setIsLoadingTasks(true);
    setIsLoadingChecks(!hasRuntimeCheck() || !hasCachedBeadsCheck(activeRepo));

    Promise.allSettled([
      (async () => {
        const beads = await refreshBeadsCheckForRepo(activeRepo, false);
        if (!beads.beadsOk) {
          throw new Error(
            beads.beadsError ?? "Beads store is not initialized for this repository.",
          );
        }

        await refreshTaskData(activeRepo);
      })(),
      refreshRuntimeCheck(false),
    ])
      .then(([tasksResult, runtimeResult]) => {
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
      })
      .finally(() => {
        if (repoLoadVersionRef.current !== loadVersion) {
          return;
        }

        setIsLoadingTasks(false);
        setIsLoadingChecks(false);
      });
  }, [
    activeRepo,
    clearActiveBeadsCheck,
    clearTaskData,
    hasCachedBeadsCheck,
    hasRuntimeCheck,
    refreshBeadsCheckForRepo,
    refreshRuntimeCheck,
    refreshTaskData,
    setIsLoadingChecks,
    setIsLoadingTasks,
  ]);
}
