import type { WorkspaceRef } from "@openducktor/contracts";
import { skippedQueryOptions } from "./skipped-query";
import type { RepoTaskData } from "./tasks";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ResolvedTaskCard } from "@openducktor/workflows";
import { unfilteredRepoTaskDataQueryOptions } from "./tasks";

/** Action owners observe retained tasks already loaded by details or session views. */
export function useTaskActionTasks(scope: WorkspaceRef | null, boardTasks: ResolvedTaskCard[]) {
  const { data } = useQuery<RepoTaskData>({
    ...(scope
      ? unfilteredRepoTaskDataQueryOptions(scope)
      : skippedQueryOptions<RepoTaskData>({
          queryKey: ["tasks", "skipped", "action-owner"],
          staleTime: Infinity,
        })),
    enabled: false,
  });
  return useMemo(() => {
    if (!scope || !data) return boardTasks;
    const visible = new Set(boardTasks.map(({ id }) => id));
    const retained = data.tasks.filter(({ id }) => !visible.has(id));
    return retained.length ? [...boardTasks, ...retained] : boardTasks;
  }, [boardTasks, data, scope]);
}
