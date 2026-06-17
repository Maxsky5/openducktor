import type { AgentSessionRecord, TaskCard } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import {
  loadAgentSessionListFromQuery,
  loadAgentSessionListsFromQuery,
} from "@/state/queries/agent-sessions";
import type { TaskSessionRecords } from "./repo-session-read-model";

export type TaskSessionRecordsByTaskId = Record<string, AgentSessionRecord[]>;

export const toTaskSessionRecords = (
  tasks: Pick<TaskCard, "id">[],
  recordsByTaskId: TaskSessionRecordsByTaskId,
): TaskSessionRecords[] =>
  tasks.map((task) => ({
    id: task.id,
    agentSessions: recordsByTaskId[task.id] ?? [],
  }));

export const loadTaskSessionRecordsForTasks = async ({
  queryClient,
  repoPath,
  tasks,
}: {
  queryClient: QueryClient;
  repoPath: string;
  tasks: Pick<TaskCard, "id">[];
}): Promise<TaskSessionRecords[]> => {
  if (tasks.length === 0) {
    return [];
  }

  const recordsByTaskId = await loadAgentSessionListsFromQuery(
    queryClient,
    repoPath,
    tasks.map((task) => task.id),
  );
  return toTaskSessionRecords(tasks, recordsByTaskId);
};

export const loadTaskSessionRecordsForTask = async ({
  queryClient,
  repoPath,
  taskId,
  forceFresh,
}: {
  queryClient: QueryClient;
  repoPath: string;
  taskId: string;
  forceFresh?: boolean;
}): Promise<TaskSessionRecords> => ({
  id: taskId,
  agentSessions: await loadAgentSessionListFromQuery(
    queryClient,
    repoPath,
    taskId,
    forceFresh === undefined ? undefined : { forceFresh },
  ),
});
