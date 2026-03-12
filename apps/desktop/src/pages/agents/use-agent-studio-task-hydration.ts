import { useEffect, useRef, useState } from "react";
import type { AgentSessionLoadOptions } from "@/types/agent-orchestrator";

type UseAgentStudioTaskHydrationParams = {
  activeRepo: string | null;
  activeTaskId: string;
  activeSessionId: string | null;
  loadAgentSessions: (taskId: string, options?: AgentSessionLoadOptions) => Promise<void>;
};

type UseAgentStudioTaskHydrationResult = {
  hydratedTasksByRepoAndTask: Record<string, boolean>;
  isActiveSessionHistoryHydrated: boolean;
  isActiveSessionHistoryHydrating: boolean;
};

export function useAgentStudioTaskHydration({
  activeRepo,
  activeTaskId,
  activeSessionId,
  loadAgentSessions,
}: UseAgentStudioTaskHydrationParams): UseAgentStudioTaskHydrationResult {
  const hydratingTasksByRepoRef = useRef(new Set<string>());
  const hydratingSessionHistoriesByRepoRef = useRef(new Set<string>());
  const hydratedSessionHistoriesByRepoRef = useRef(new Set<string>());
  const previousRepoRef = useRef<string | null>(activeRepo);
  const [hydratedTasksByRepoAndTask, setHydratedTasksByRepoAndTask] = useState<
    Record<string, boolean>
  >({});
  const [sessionHistoryStatusByRepoKey, setSessionHistoryStatusByRepoKey] = useState<
    Record<string, "hydrating" | "hydrated">
  >({});

  useEffect(() => {
    if (previousRepoRef.current === activeRepo) {
      return;
    }
    previousRepoRef.current = activeRepo;
    hydratingTasksByRepoRef.current.clear();
    hydratingSessionHistoriesByRepoRef.current.clear();
    hydratedSessionHistoriesByRepoRef.current.clear();
    setHydratedTasksByRepoAndTask({});
    setSessionHistoryStatusByRepoKey({});
  }, [activeRepo]);

  useEffect(() => {
    if (!activeRepo || !activeTaskId) {
      return;
    }

    const hydrationKey = `${activeRepo}:${activeTaskId}`;
    if (hydratedTasksByRepoAndTask[hydrationKey]) {
      return;
    }
    if (hydratingTasksByRepoRef.current.has(hydrationKey)) {
      return;
    }

    hydratingTasksByRepoRef.current.add(hydrationKey);
    let cancelled = false;
    void loadAgentSessions(activeTaskId)
      .then(() => {
        if (cancelled) {
          return;
        }
        setHydratedTasksByRepoAndTask((current) => {
          if (current[hydrationKey] === true) {
            return current;
          }
          return {
            ...current,
            [hydrationKey]: true,
          };
        });
      })
      .catch(() => {
        // Keep task unhydrated so callers can retry after load failures.
      })
      .finally(() => {
        hydratingTasksByRepoRef.current.delete(hydrationKey);
      });

    return () => {
      cancelled = true;
    };
  }, [activeRepo, activeTaskId, hydratedTasksByRepoAndTask, loadAgentSessions]);

  useEffect(() => {
    if (!activeRepo || !activeTaskId || !activeSessionId) {
      return;
    }

    const sessionHydrationKey = `${activeRepo}:${activeTaskId}:${activeSessionId}`;
    if (hydratedSessionHistoriesByRepoRef.current.has(sessionHydrationKey)) {
      return;
    }
    if (hydratingSessionHistoriesByRepoRef.current.has(sessionHydrationKey)) {
      return;
    }

    hydratingSessionHistoriesByRepoRef.current.add(sessionHydrationKey);
    setSessionHistoryStatusByRepoKey((current) => ({
      ...current,
      [sessionHydrationKey]: "hydrating",
    }));
    let cancelled = false;
    void loadAgentSessions(activeTaskId, {
      hydrateHistoryForSessionId: activeSessionId,
    })
      .then(() => {
        if (cancelled) {
          return;
        }
        hydratedSessionHistoriesByRepoRef.current.add(sessionHydrationKey);
        setSessionHistoryStatusByRepoKey((current) => ({
          ...current,
          [sessionHydrationKey]: "hydrated",
        }));
      })
      .catch(() => {
        // Keep history unhydrated so callers can retry after load failures.
        setSessionHistoryStatusByRepoKey((current) => {
          const { [sessionHydrationKey]: _removed, ...rest } = current;
          return rest;
        });
      })
      .finally(() => {
        hydratingSessionHistoriesByRepoRef.current.delete(sessionHydrationKey);
      });

    return () => {
      cancelled = true;
    };
  }, [activeRepo, activeSessionId, activeTaskId, loadAgentSessions]);

  const activeSessionHistoryKey =
    activeRepo && activeTaskId && activeSessionId
      ? `${activeRepo}:${activeTaskId}:${activeSessionId}`
      : "";
  const activeSessionHistoryStatus = activeSessionHistoryKey
    ? sessionHistoryStatusByRepoKey[activeSessionHistoryKey]
    : undefined;

  return {
    hydratedTasksByRepoAndTask,
    isActiveSessionHistoryHydrated: activeSessionHistoryStatus === "hydrated",
    isActiveSessionHistoryHydrating: activeSessionHistoryStatus === "hydrating",
  };
}
