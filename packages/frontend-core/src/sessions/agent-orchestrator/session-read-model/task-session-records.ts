import type { AgentSessionRecord } from "@openducktor/contracts";
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
  taskIds: string[];
  records: PersistedTaskSessionRecord[];
};
export type TaskSessionRecordsByTaskId = Record<string, AgentSessionRecord[]>;

export const toLoadedWorkflowSessionRecords = (
  taskSessionRecords: TaskSessionRecords,
): LoadedWorkflowSessionRecords => ({
  loadedTaskIds: new Set(taskSessionRecords.taskIds),
  records: taskSessionRecords.records,
});

export const toTaskSessionRecords = (
  tasks: Pick<TaskCard, "id">[],
  recordsByTaskId: TaskSessionRecordsByTaskId,
): TaskSessionRecords => {
  const records: PersistedTaskSessionRecord[] = [];
  for (const task of tasks) {
    for (const record of recordsByTaskId[task.id] ?? []) {
      records.push({ taskId: task.id, record });
    }
  }

  return {
    taskIds: tasks.map((task) => task.id),
    records,
  };
};

export const readCachedTaskSessionRecords = (
  queryClient: QueryClient,
  repoPath: string,
  taskIds: string[],
): TaskSessionRecords | null => {
  const normalizedTaskIds = normalizeAgentSessionTaskIds(taskIds);
  const recordsByTaskId: TaskSessionRecordsByTaskId = {};
  for (const taskId of normalizedTaskIds) {
    // One read for each task: each session change reads every task of the workspace.
    const state = queryClient.getQueryState<AgentSessionRecord[]>(
      agentSessionQueryKeys.list(repoPath, taskId),
    );
    if (state?.status !== "success" || state.isInvalidated || state.data === undefined) {
      return null;
    }
    recordsByTaskId[taskId] = state.data;
  }
  return toTaskSessionRecords(
    normalizedTaskIds.map((id) => ({ id })),
    recordsByTaskId,
  );
};

export const loadTaskSessionRecordsForTasks = async ({
  queryClient,
  repoPath,
  tasks,
  forceFresh,
}: {
  queryClient: QueryClient;
  repoPath: string;
  tasks: Pick<TaskCard, "id">[];
  forceFresh?: boolean;
}): Promise<TaskSessionRecords> => {
  if (tasks.length === 0) {
    return { taskIds: [], records: [] };
  }

  const recordsByTaskId = await loadAgentSessionListsFromQuery(
    queryClient,
    repoPath,
    tasks.map((task) => task.id),
    forceFresh === undefined ? undefined : { forceFresh },
  );
  return toTaskSessionRecords(tasks, recordsByTaskId);
};
