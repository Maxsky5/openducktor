import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionLoadOptions } from "@/types/agent-orchestrator";

type UseAgentStudioTaskHydrationParams = {
  activeRepo: string | null;
  activeTaskId: string;
  activeSessionId: string | null;
  loadAgentSessions: (taskId: string, options?: AgentSessionLoadOptions) => Promise<void>;
};

type UseAgentStudioTaskHydrationResult = {
  hydratedTasksByRepoAndTask: Record<string, boolean>;
  isActiveTaskHydrationFailed: boolean;
  isActiveSessionHistoryHydrated: boolean;
  isActiveSessionHistoryHydrationFailed: boolean;
  isActiveSessionHistoryHydrating: boolean;
};

type HydrationStatus = "hydrating" | "hydrated" | "failed";

const clearHydrationStatus = (
  key: string,
  setStatus: Dispatch<SetStateAction<Record<string, HydrationStatus>>>,
): void => {
  setStatus((current) => {
    if (current[key] !== "hydrating") {
      return current;
    }
    const { [key]: _removed, ...rest } = current;
    return rest;
  });
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
  const [taskHydrationStatusByRepoKey, setTaskHydrationStatusByRepoKey] = useState<
    Record<string, HydrationStatus>
  >({});
  const [sessionHistoryStatusByRepoKey, setSessionHistoryStatusByRepoKey] = useState<
    Record<string, HydrationStatus>
  >({});
  const [hydrationRetryVersion, setHydrationRetryVersion] = useState(0);

  useEffect(() => {
    if (previousRepoRef.current === activeRepo) {
      return;
    }
    previousRepoRef.current = activeRepo;
    hydratingTasksByRepoRef.current.clear();
    hydratingSessionHistoriesByRepoRef.current.clear();
    hydratedSessionHistoriesByRepoRef.current.clear();
    setHydratedTasksByRepoAndTask({});
    setTaskHydrationStatusByRepoKey({});
    setSessionHistoryStatusByRepoKey({});
  }, [activeRepo]);

  const activeTaskHydrationKey = activeRepo && activeTaskId ? `${activeRepo}:${activeTaskId}` : "";
  const activeSessionHistoryKey =
    activeRepo && activeTaskId && activeSessionId
      ? `${activeRepo}:${activeTaskId}:${activeSessionId}`
      : "";

  useEffect(() => {
    if (!activeRepo || !activeTaskId || activeSessionId) {
      return;
    }

    const hydrationKey = activeTaskHydrationKey;
    if (hydratedTasksByRepoAndTask[hydrationKey]) {
      return;
    }
    if (hydratingTasksByRepoRef.current.has(hydrationKey)) {
      return;
    }

    hydratingTasksByRepoRef.current.add(hydrationKey);
    setTaskHydrationStatusByRepoKey((current) => ({
      ...current,
      [hydrationKey]: "hydrating",
    }));
    const currentHydrationRetryVersion = hydrationRetryVersion;
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
        setTaskHydrationStatusByRepoKey((current) => ({
          ...current,
          [hydrationKey]: "hydrated",
        }));
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        console.warn(
          `Failed to hydrate task session context for ${activeTaskId}: ${errorMessage(error)}`,
        );
        setTaskHydrationStatusByRepoKey((current) => ({
          ...current,
          [hydrationKey]: "failed",
        }));
      })
      .finally(() => {
        hydratingTasksByRepoRef.current.delete(hydrationKey);
        if (cancelled) {
          clearHydrationStatus(hydrationKey, setTaskHydrationStatusByRepoKey);
          setHydrationRetryVersion((current) =>
            current === currentHydrationRetryVersion ? current + 1 : current,
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeRepo,
    activeSessionId,
    activeTaskHydrationKey,
    activeTaskId,
    hydrationRetryVersion,
    hydratedTasksByRepoAndTask,
    loadAgentSessions,
  ]);

  useEffect(() => {
    if (!activeRepo || !activeTaskId || !activeSessionId) {
      return;
    }

    const taskHydrationKey = activeTaskHydrationKey;
    const sessionHydrationKey = activeSessionHistoryKey;
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
    const currentHydrationRetryVersion = hydrationRetryVersion;
    let cancelled = false;
    void loadAgentSessions(activeTaskId, {
      hydrateHistoryForSessionId: activeSessionId,
    })
      .then(() => {
        if (cancelled) {
          return;
        }
        setHydratedTasksByRepoAndTask((current) => {
          if (current[taskHydrationKey] === true) {
            return current;
          }
          return {
            ...current,
            [taskHydrationKey]: true,
          };
        });
        setTaskHydrationStatusByRepoKey((current) => ({
          ...current,
          [taskHydrationKey]: "hydrated",
        }));
        hydratedSessionHistoriesByRepoRef.current.add(sessionHydrationKey);
        setSessionHistoryStatusByRepoKey((current) => ({
          ...current,
          [sessionHydrationKey]: "hydrated",
        }));
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        console.warn(
          `Failed to hydrate session history for ${activeSessionId}: ${errorMessage(error)}`,
        );
        setTaskHydrationStatusByRepoKey((current) => {
          if (current[taskHydrationKey] === "hydrated") {
            return current;
          }
          return {
            ...current,
            [taskHydrationKey]: "failed",
          };
        });
        setSessionHistoryStatusByRepoKey((current) => {
          return {
            ...current,
            [sessionHydrationKey]: "failed",
          };
        });
      })
      .finally(() => {
        hydratingSessionHistoriesByRepoRef.current.delete(sessionHydrationKey);
        if (cancelled) {
          clearHydrationStatus(sessionHydrationKey, setSessionHistoryStatusByRepoKey);
          setHydrationRetryVersion((current) =>
            current === currentHydrationRetryVersion ? current + 1 : current,
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeRepo,
    activeSessionHistoryKey,
    activeSessionId,
    activeTaskHydrationKey,
    activeTaskId,
    hydrationRetryVersion,
    loadAgentSessions,
  ]);

  const activeTaskHydrationStatus = activeTaskHydrationKey
    ? taskHydrationStatusByRepoKey[activeTaskHydrationKey]
    : undefined;
  const activeSessionHistoryStatus = activeSessionHistoryKey
    ? sessionHistoryStatusByRepoKey[activeSessionHistoryKey]
    : undefined;

  return {
    hydratedTasksByRepoAndTask,
    isActiveTaskHydrationFailed: activeTaskHydrationStatus === "failed",
    isActiveSessionHistoryHydrated: activeSessionHistoryStatus === "hydrated",
    isActiveSessionHistoryHydrationFailed: activeSessionHistoryStatus === "failed",
    isActiveSessionHistoryHydrating: activeSessionHistoryStatus === "hydrating",
  };
}
