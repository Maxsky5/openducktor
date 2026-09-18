import type { AgentSessionRecord } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionReadPort } from "@/state/queries/agent-sessions";
import { useAgentSessionLists } from "@/state/queries/use-agent-session-lists";

export const TASK_SESSION_HISTORY_ERROR_TOAST_ID = "task-session-history-error";

type UseTaskDetailsHistoricalSessionsArgs = {
  repoPath: string | null;
  taskId: string | null;
  enabled: boolean;
  readPort?: AgentSessionReadPort;
};

type ReportedSessionHistoryError = {
  key: string;
  description: string;
};

export function useTaskDetailsHistoricalSessions({
  repoPath,
  taskId,
  enabled,
  readPort,
}: UseTaskDetailsHistoricalSessionsArgs): AgentSessionRecord[] {
  const queryClient = useQueryClient();
  const taskIds = useMemo(() => (taskId ? [taskId] : []), [taskId]);
  const listArgs: Parameters<typeof useAgentSessionLists>[0] = {
    repoPath,
    taskIds,
    enabled: enabled && repoPath !== null && taskIds.length > 0,
    queryClient,
  };
  if (readPort) {
    listArgs.readPort = readPort;
  }
  const sessionLists = useAgentSessionLists(listArgs);
  const sessionListsError = sessionLists.error;
  const errorKey = repoPath !== null && taskId !== null ? `${repoPath}:${taskId}` : null;
  const reportedErrorRef = useRef<ReportedSessionHistoryError | null>(null);
  useEffect(() => {
    if (!sessionListsError || !errorKey) {
      reportedErrorRef.current = null;
      return;
    }

    const description = errorMessage(sessionListsError);
    const reportedError = reportedErrorRef.current;
    if (reportedError?.key === errorKey && reportedError.description === description) {
      return;
    }

    reportedErrorRef.current = { key: errorKey, description };
    toast.error("Failed to load task session history", {
      id: `${TASK_SESSION_HISTORY_ERROR_TOAST_ID}:${errorKey}`,
      description,
    });
  }, [errorKey, sessionListsError]);

  return useMemo(
    () => (taskId ? (sessionLists.data[taskId] ?? []) : []),
    [sessionLists.data, taskId],
  );
}
