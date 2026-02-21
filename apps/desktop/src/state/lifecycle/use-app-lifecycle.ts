import { errorMessage } from "@/lib/errors";
import { subscribeRunEvents } from "@/lib/host-client";
import { summarizeTaskLoadError } from "@/state/tasks/task-load-errors";
import type { RepoOpencodeHealthCheck } from "@/types/diagnostics";
import { type RunEvent, runEventSchema } from "@openducktor/contracts";
import { type Dispatch, type SetStateAction, useEffect, useRef } from "react";
import { toast } from "sonner";

type UseAppLifecycleArgs = {
  activeRepo: string | null;
  setEvents: Dispatch<SetStateAction<RunEvent[]>>;
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
  refreshRepoOpencodeHealthForRepo: (
    repoPath: string,
    force?: boolean,
  ) => Promise<RepoOpencodeHealthCheck>;
  refreshTaskData: (repoPath: string) => Promise<void>;
  clearTaskData: () => void;
  clearBranchData: () => void;
  clearActiveBeadsCheck: () => void;
  clearActiveRepoOpencodeHealth: () => void;
  setIsLoadingTasks: (value: boolean) => void;
  setIsLoadingChecks: (value: boolean) => void;
  hasRuntimeCheck: () => boolean;
  hasCachedBeadsCheck: (repoPath: string) => boolean;
  hasCachedRepoOpencodeHealth: (repoPath: string) => boolean;
};

export function useAppLifecycle({
  activeRepo,
  setEvents,
  refreshWorkspaces,
  refreshBranches,
  refreshRuntimeCheck,
  refreshBeadsCheckForRepo,
  refreshRepoOpencodeHealthForRepo,
  refreshTaskData,
  clearTaskData,
  clearBranchData,
  clearActiveBeadsCheck,
  clearActiveRepoOpencodeHealth,
  setIsLoadingTasks,
  setIsLoadingChecks,
  hasRuntimeCheck,
  hasCachedBeadsCheck,
  hasCachedRepoOpencodeHealth,
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
      clearBranchData();
      clearActiveBeadsCheck();
      clearActiveRepoOpencodeHealth();
      setIsLoadingTasks(false);
      setIsLoadingChecks(false);
      return;
    }

    const loadVersion = ++repoLoadVersionRef.current;
    setIsLoadingTasks(true);
    setIsLoadingChecks(
      !hasRuntimeCheck() ||
        !hasCachedBeadsCheck(activeRepo) ||
        !hasCachedRepoOpencodeHealth(activeRepo),
    );

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
      refreshRepoOpencodeHealthForRepo(activeRepo, false),
      refreshBranches(false),
    ])
      .then(([tasksResult, runtimeResult, opencodeHealthResult, branchesResult]) => {
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

        if (opencodeHealthResult.status === "rejected") {
          toast.error("OpenCode + MCP diagnostics unavailable", {
            description: errorMessage(opencodeHealthResult.reason),
          });
        } else if (!opencodeHealthResult.value.runtimeOk || !opencodeHealthResult.value.mcpOk) {
          toast.error("OpenCode + MCP unavailable", {
            description:
              opencodeHealthResult.value.errors.join(" | ") ||
              "OpenCode runtime or OpenDucktor MCP is not ready.",
          });
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

        setIsLoadingTasks(false);
        setIsLoadingChecks(false);
      });
  }, [
    activeRepo,
    clearBranchData,
    clearActiveBeadsCheck,
    clearActiveRepoOpencodeHealth,
    clearTaskData,
    hasCachedBeadsCheck,
    hasCachedRepoOpencodeHealth,
    hasRuntimeCheck,
    refreshBeadsCheckForRepo,
    refreshBranches,
    refreshRepoOpencodeHealthForRepo,
    refreshRuntimeCheck,
    refreshTaskData,
    setIsLoadingChecks,
    setIsLoadingTasks,
  ]);
}
