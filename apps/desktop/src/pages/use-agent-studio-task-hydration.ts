import { useEffect, useRef, useState } from "react";

type UseAgentStudioTaskHydrationParams = {
  activeRepo: string | null;
  activeTaskId: string;
  tabTaskIds: string[];
  loadAgentSessions: (taskId: string) => Promise<void>;
};

export function useAgentStudioTaskHydration({
  activeRepo,
  activeTaskId,
  tabTaskIds,
  loadAgentSessions,
}: UseAgentStudioTaskHydrationParams): Record<string, boolean> {
  const hydratingTaskTabsByRepoRef = useRef(new Set<string>());
  const previousRepoRef = useRef<string | null>(activeRepo);
  const [hydratedTasksByRepoAndTask, setHydratedTasksByRepoAndTask] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    if (previousRepoRef.current === activeRepo) {
      return;
    }
    previousRepoRef.current = activeRepo;
    hydratingTaskTabsByRepoRef.current.clear();
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
    if (hydratingTaskTabsByRepoRef.current.has(hydrationKey)) {
      return;
    }

    hydratingTaskTabsByRepoRef.current.add(hydrationKey);
    let cancelled = false;
    void loadAgentSessions(activeTaskId).finally(() => {
      hydratingTaskTabsByRepoRef.current.delete(hydrationKey);
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
    });

    return () => {
      cancelled = true;
    };
  }, [activeRepo, activeTaskId, hydratedTasksByRepoAndTask, loadAgentSessions]);

  useEffect(() => {
    if (!activeRepo || tabTaskIds.length === 0) {
      return;
    }

    let cancelled = false;
    const pendingTaskIds = tabTaskIds.filter((taskId) => {
      if (!taskId || taskId === activeTaskId) {
        return false;
      }
      const hydrationKey = `${activeRepo}:${taskId}`;
      if (hydratedTasksByRepoAndTask[hydrationKey]) {
        return false;
      }
      if (hydratingTaskTabsByRepoRef.current.has(hydrationKey)) {
        return false;
      }
      hydratingTaskTabsByRepoRef.current.add(hydrationKey);
      return true;
    });

    if (pendingTaskIds.length === 0) {
      return;
    }

    for (const taskId of pendingTaskIds) {
      const hydrationKey = `${activeRepo}:${taskId}`;
      void loadAgentSessions(taskId).finally(() => {
        hydratingTaskTabsByRepoRef.current.delete(hydrationKey);
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
      });
    }

    return () => {
      cancelled = true;
    };
  }, [activeRepo, activeTaskId, hydratedTasksByRepoAndTask, loadAgentSessions, tabTaskIds]);

  return hydratedTasksByRepoAndTask;
}
