import type { AgentSessionRecord } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { useAgentSessionLists } from "@/state/queries/use-agent-session-lists";

export const TASK_SESSION_HISTORY_ERROR_TOAST_ID = "task-session-history-error";

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
  const sessionListsError = sessionLists.error;
  const reportedErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (!sessionListsError) {
      reportedErrorRef.current = null;
      return;
    }

    const description = errorMessage(sessionListsError);
    if (reportedErrorRef.current === description) {
      return;
    }

    reportedErrorRef.current = description;
    toast.error("Failed to load task session history", {
      id: TASK_SESSION_HISTORY_ERROR_TOAST_ID,
      description,
    });
  }, [sessionListsError]);

  return useMemo(
    () => (taskId ? (sessionLists.data[taskId] ?? []) : []),
    [sessionLists.data, taskId],
  );
}
