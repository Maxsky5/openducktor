import type { AgentSessionRecord, WorkspaceRef } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import {
  agentSessionQueryKeys,
  loadAgentSessionListsFromQuery,
  normalizeAgentSessionTaskIds,
} from "../../../queries/agent-sessions";
import type { PersistedTaskSessionRecord } from "../support/persistence";
import type { LoadedWorkflowSessionRecords } from "./agent-session-workflow-records";
import type { BuiltinTaskCard as TaskCard } from "@openducktor/workflows";

export type TaskSessionRecords = {
  workspaceId: string;
  taskIds: string[];
  records: PersistedTaskSessionRecord[];
};
export type TaskSessionRecordsByTaskId = Record<string, AgentSessionRecord[]>;

export const toLoadedWorkflowSessionRecords = (
  taskSessionRecords: TaskSessionRecords,
): LoadedWorkflowSessionRecords => ({
  workspaceId: taskSessionRecords.workspaceId,
  loadedTaskIds: new Set(taskSessionRecords.taskIds),
  records: taskSessionRecords.records,
});

export const toTaskSessionRecords = (
  tasks: Pick<TaskCard, "id">[],
  recordsByTaskId: TaskSessionRecordsByTaskId,
  workspaceId: string,
): TaskSessionRecords => {
  const records: PersistedTaskSessionRecord[] = [];
  for (const task of tasks) {
    for (const record of recordsByTaskId[task.id] ?? []) {
      records.push({ workspaceId, taskId: task.id, record });
    }
  }

  return {
    workspaceId,
    taskIds: tasks.map((task) => task.id),
    records,
  };
};

export const readCachedTaskSessionRecords = (
  queryClient: QueryClient,
  scope: WorkspaceRef,
  taskIds: string[],
): TaskSessionRecords | null => {
  const normalizedTaskIds = normalizeAgentSessionTaskIds(taskIds);
  const recordsByTaskId: TaskSessionRecordsByTaskId = {};
  for (const taskId of normalizedTaskIds) {
    // One read for each task: each session change reads every task of the workspace.
    const state = queryClient.getQueryState<AgentSessionRecord[]>(
      agentSessionQueryKeys.list(scope, taskId),
    );
    if (state?.status !== "success" || state.isInvalidated || state.data === undefined) {
      return null;
    }
    recordsByTaskId[taskId] = state.data;
  }
  return toTaskSessionRecords(
    normalizedTaskIds.map((id) => ({ id })),
    recordsByTaskId,
    scope.workspaceId,
  );
};

export const loadTaskSessionRecordsForTasks = async ({
  queryClient,
  repoPath,
  workspaceId,
  tasks,
  forceFresh,
}: {
  queryClient: QueryClient;
  repoPath: string;
  workspaceId: string;
  tasks: Pick<TaskCard, "id">[];
  forceFresh?: boolean;
}): Promise<TaskSessionRecords> => {
  if (tasks.length === 0) {
    return { workspaceId, taskIds: [], records: [] };
  }

  const recordsByTaskId = await loadAgentSessionListsFromQuery(
    queryClient,
    { workspaceId, repoPath },
    tasks.map((task) => task.id),
    forceFresh === undefined ? undefined : { forceFresh },
  );
  return toTaskSessionRecords(tasks, recordsByTaskId, workspaceId);
};
