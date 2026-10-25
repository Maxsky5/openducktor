import type { AgentSessionRecord } from "@openducktor/contracts";
import { useAgentSessionLists } from "@openducktor/frontend-core/queries/use-agent-session-lists";
import { useAgentSessionSummaries } from "@openducktor/frontend-core/sessions/session-store-hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { groupTaskSessions } from "./task-sessions-model";

const EMPTY_RECORDS: readonly AgentSessionRecord[] = [];
const NO_TASK_IDS: string[] = [];

/**
 * The sessions of a task, from its session history and the live session store, grouped by
 * Workflow Role, with the saved records and the state of the history read. A null task reads
 * nothing.
 */
export function useTaskSessionGroups(repoPath: string, taskId: string | null) {
  const summaries = useAgentSessionSummaries();
  const queryClient = useQueryClient();
  const taskIds = useMemo(() => (taskId ? [taskId] : NO_TASK_IDS), [taskId]);
  const history = useAgentSessionLists({
    repoPath,
    taskIds,
    enabled: taskId !== null,
    queryClient,
  });
  const records = taskId ? (history.data[taskId] ?? EMPTY_RECORDS) : EMPTY_RECORDS;
  const groups = useMemo(
    () => (taskId ? groupTaskSessions(taskId, records, summaries) : []),
    [records, summaries, taskId],
  );
  return {
    groups,
    summaries,
    records,
    isLoadingHistory: history.isPending,
    historyError: history.error,
  };
}
