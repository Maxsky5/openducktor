import { useQuery } from "@tanstack/react-query";
import { taskWorkflowContextQueryOptions } from "@openducktor/frontend-core/queries/task-workflow-context";
import type { AgentSessionRecord, WorkspaceRef } from "@openducktor/contracts";
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
export function useTaskSessionGroups(scope: WorkspaceRef, taskId: string | null) {
  const taskQuery = useQuery({
    ...taskWorkflowContextQueryOptions(scope, taskId ?? ""),
    enabled: taskId !== null,
  });
  const summaries = useAgentSessionSummaries();
  const queryClient = useQueryClient();
  const taskIds = useMemo(() => (taskId ? [taskId] : NO_TASK_IDS), [taskId]);
  const history = useAgentSessionLists({
    ...scope,
    taskIds,
    enabled: taskId !== null,
    queryClient,
  });
  const records = taskId ? (history.data[taskId] ?? EMPTY_RECORDS) : EMPTY_RECORDS;
  const groups = useMemo(
    () =>
      taskQuery.data
        ? groupTaskSessions(taskQuery.data, records, summaries, scope.workspaceId)
        : [],
    [records, summaries, taskQuery.data, scope.workspaceId],
  );
  return {
    groups,
    summaries,
    records,
    isLoadingHistory: history.isPending || (!!taskId && taskQuery.isPending),
    historyError: history.error ?? taskQuery.error?.message ?? null,
  };
}
