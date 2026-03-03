import { useEffect, useRef, useState } from "react";
import type { AgentSessionLoadOptions } from "@/types/agent-orchestrator";

type UseAgentStudioTaskHydrationParams = {
  activeRepo: string | null;
  activeTaskId: string;
  activeSessionId: string | null;
  loadAgentSessions: (taskId: string, options?: AgentSessionLoadOptions) => Promise<void>;
};

export function useAgentStudioTaskHydration({
  activeRepo,
  activeTaskId,
  activeSessionId,
  loadAgentSessions,
}: UseAgentStudioTaskHydrationParams): Record<string, boolean> {
  const hydratingTasksByRepoRef = useRef(new Set<string>());
  const hydratingSessionHistoriesByRepoRef = useRef(new Set<string>());
  const hydratedSessionHistoriesByRepoRef = useRef(new Set<string>());
  const previousRepoRef = useRef<string | null>(activeRepo);
  const [hydratedTasksByRepoAndTask, setHydratedTasksByRepoAndTask] = useState<
    Record<string, boolean>
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
    let cancelled = false;
    void loadAgentSessions(activeTaskId, {
      hydrateHistoryForSessionId: activeSessionId,
    })
      .then(() => {
        if (cancelled) {
          return;
        }
        hydratedSessionHistoriesByRepoRef.current.add(sessionHydrationKey);
      })
      .catch(() => {
        // Keep history unhydrated so callers can retry after load failures.
      })
      .finally(() => {
        hydratingSessionHistoriesByRepoRef.current.delete(sessionHydrationKey);
      });

    return () => {
      cancelled = true;
    };
  }, [activeRepo, activeSessionId, activeTaskId, loadAgentSessions]);

  return hydratedTasksByRepoAndTask;
}
