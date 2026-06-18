import type { AgentSessionRecord, TaskCard } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { loadAgentSessionListsFromQuery } from "@/state/queries/agent-sessions";
import type { PersistedTaskSessionRecord } from "../support/persistence";

export type TaskSessionRecords = {
  id: string;
  agentSessions: AgentSessionRecord[];
};
export type TaskSessionRecordsByTaskId = Record<string, AgentSessionRecord[]>;

export const collectTaskSessionRecords = (
  tasks: TaskSessionRecords[],
): PersistedTaskSessionRecord[] => {
  const records: PersistedTaskSessionRecord[] = [];
  for (const task of tasks) {
    for (const record of task.agentSessions) {
      records.push({ taskId: task.id, record });
    }
  }
  return records;
};

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
  forceFresh,
}: {
  queryClient: QueryClient;
  repoPath: string;
  tasks: Pick<TaskCard, "id">[];
  forceFresh?: boolean;
}): Promise<TaskSessionRecords[]> => {
  if (tasks.length === 0) {
    return [];
  }

  const recordsByTaskId = await loadAgentSessionListsFromQuery(
    queryClient,
    repoPath,
    tasks.map((task) => task.id),
    forceFresh === undefined ? undefined : { forceFresh },
  );
  return toTaskSessionRecords(tasks, recordsByTaskId);
};
