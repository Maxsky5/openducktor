import type { AgentSessionRecord } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useAgentSessionLists } from "@/state/queries/use-agent-session-lists";

type UseTaskDetailsHistoricalSessionsArgs = {
  repoPath: string | null;
  taskId: string | null;
  enabled: boolean;
};

export function useTaskDetailsHistoricalSessions({
  repoPath,
  taskId,
  enabled,
}: UseTaskDetailsHistoricalSessionsArgs): AgentSessionRecord[] {
  const queryClient = useQueryClient();
  const taskIds = useMemo(() => (taskId ? [taskId] : []), [taskId]);
  const sessionLists = useAgentSessionLists({
    repoPath,
    taskIds,
    enabled: enabled && repoPath !== null && taskIds.length > 0,
    queryClient,
  });

  return useMemo(
    () => (taskId ? (sessionLists.data[taskId] ?? []) : []),
    [sessionLists.data, taskId],
  );
}
