import type { AgentSessionRecord, RuntimeKind, TaskCard } from "@openducktor/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createRepoSessionHydrationService } from "../lifecycle/repo-session-hydration-service";
import type { RepoSessionPresencePreloads } from "../lifecycle/repo-session-presence-preloads";
import type { SessionHydrationOperations } from "../lifecycle/session-hydration-operations";

type UseRepoSessionHydrationEffectsArgs = {
  workspaceRepoPath: string | null;
  tasks: TaskCard[];
  currentWorkspaceRepoPathRef: { current: string | null };
  sessionHydration: Pick<
    SessionHydrationOperations,
    "bootstrapTaskSessions" | "reconcileLiveTaskSessions"
  >;
  prepareRepoSessionPresencePreloads?: (input: {
    repoPath: string;
    records: AgentSessionRecord[];
  }) => Promise<RepoSessionPresencePreloads>;
  isSessionRuntimeReady: (runtimeKind: RuntimeKind) => boolean;
};

export const useRepoSessionHydrationEffects = ({
  workspaceRepoPath,
  tasks,
  currentWorkspaceRepoPathRef,
  sessionHydration,
  prepareRepoSessionPresencePreloads,
  isSessionRuntimeReady,
}: UseRepoSessionHydrationEffectsArgs) => {
  const [sessionRetryTick, setSessionRetryTick] = useState(0);

  const repoSessionHydrationService = useMemo(
    () =>
      createRepoSessionHydrationService({
        sessionHydration,
        ...(prepareRepoSessionPresencePreloads ? { prepareRepoSessionPresencePreloads } : {}),
        onRetryRequested: () => {
          setSessionRetryTick((current) => current + 1);
        },
      }),
    [prepareRepoSessionPresencePreloads, sessionHydration],
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
    if (!workspaceRepoPath || tasks.length === 0) {
      return;
    }
    // Retry requests intentionally re-run this effect even though the tick is not part of the
    // reconciliation payload.
    void sessionRetryTick;
    let cancelled = false;

    void (async () => {
      await repoSessionHydrationService.bootstrapPersistedTaskSessions({
        repoPath: workspaceRepoPath,
        tasks,
        isCurrentRepo: isCurrentActiveRepo,
      });
      await repoSessionHydrationService.reconcilePendingTasks({
        repoPath: workspaceRepoPath,
        tasks,
        isCancelled: () => cancelled,
        isCurrentRepo: isCurrentActiveRepo,
        isRuntimeReady: isSessionRuntimeReady,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    workspaceRepoPath,
    isCurrentActiveRepo,
    isSessionRuntimeReady,
    repoSessionHydrationService,
    sessionRetryTick,
    tasks,
  ]);
};
