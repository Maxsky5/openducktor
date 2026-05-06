import type { TaskCard } from "@openducktor/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createRepoSessionHydrationService } from "../lifecycle/repo-session-hydration-service";
import type { SessionHydrationOperations } from "../lifecycle/session-hydration-operations";
import type { AgentSessionPresenceStore } from "../lifecycle/session-presence-store";

type UseRepoSessionHydrationEffectsArgs = {
  workspaceRepoPath: string | null;
  tasks: TaskCard[];
  currentWorkspaceRepoPathRef: { current: string | null };
  agentSessionPresenceStore: AgentSessionPresenceStore;
  sessionHydration: Pick<
    SessionHydrationOperations,
    "bootstrapTaskSessions" | "reconcileLiveTaskSessions"
  >;
};

export const useRepoSessionHydrationEffects = ({
  workspaceRepoPath,
  tasks,
  currentWorkspaceRepoPathRef,
  agentSessionPresenceStore,
  sessionHydration,
}: UseRepoSessionHydrationEffectsArgs) => {
  const [sessionRetryTick, setSessionRetryTick] = useState(0);

  const repoSessionHydrationService = useMemo(
    () =>
      createRepoSessionHydrationService({
        sessionHydration,
        agentSessionPresenceStore,
        onRetryRequested: () => {
          setSessionRetryTick((current) => current + 1);
        },
      }),
    [agentSessionPresenceStore, sessionHydration],
  );

  const isCurrentActiveRepo = useCallback(
    (repoPath: string): boolean => currentWorkspaceRepoPathRef.current === repoPath,
    [currentWorkspaceRepoPathRef],
  );

  useEffect(() => {
    return () => repoSessionHydrationService.dispose();
  }, [repoSessionHydrationService]);

  useEffect(() => {
    if (!workspaceRepoPath) {
      return;
    }
    repoSessionHydrationService.resetRepo(workspaceRepoPath);
  }, [workspaceRepoPath, repoSessionHydrationService]);

  useEffect(() => {
    if (!workspaceRepoPath) {
      return;
    }
    void sessionRetryTick;
    let cancelled = false;

    void (async () => {
      await repoSessionHydrationService.bootstrapPendingTasks({
        repoPath: workspaceRepoPath,
        tasks,
        isCancelled: () => cancelled,
        isCurrentRepo: isCurrentActiveRepo,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    workspaceRepoPath,
    isCurrentActiveRepo,
    repoSessionHydrationService,
    sessionRetryTick,
    tasks,
  ]);

  useEffect(() => {
    if (!workspaceRepoPath || tasks.length === 0) {
      return;
    }
    void sessionRetryTick;
    let cancelled = false;

    void (async () => {
      await repoSessionHydrationService.reconcilePendingTasks({
        repoPath: workspaceRepoPath,
        tasks,
        isCancelled: () => cancelled,
        isCurrentRepo: isCurrentActiveRepo,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    workspaceRepoPath,
    isCurrentActiveRepo,
    repoSessionHydrationService,
    sessionRetryTick,
    tasks,
  ]);

  return {
    agentSessionPresenceStore,
  };
};
