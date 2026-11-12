import type { QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { AgentSessionReadPort } from "../../../queries/agent-sessions";
import { useAgentSessionLists } from "../../../queries/use-agent-session-lists";
import { type TaskSessionRecords, toTaskSessionRecords } from "./task-session-records";

/**
 * `loaded` holds the record lists that were read while other lists still load or failed. Only
 * these tasks can prove that a session record disappeared.
 */
export type TaskSessionRecordsState =
  | { kind: "loading"; loaded: TaskSessionRecords | null }
  | { kind: "failed"; error: unknown; loaded: TaskSessionRecords | null }
  | { kind: "ready"; records: TaskSessionRecords };

type UseTaskSessionRecordsArgs = {
  repoPath: string | null;
  workspaceId: string | null;
  taskIds: string[];
  enabled: boolean;
  queryClient: QueryClient;
  readPort: AgentSessionReadPort;
};

export const useTaskSessionRecords = ({
  repoPath,
  workspaceId,
  taskIds,
  enabled,
  queryClient,
  readPort,
}: UseTaskSessionRecordsArgs): TaskSessionRecordsState => {
  const sessionLists = useAgentSessionLists({
    repoPath,
    workspaceId,
    taskIds,
    enabled,
    queryClient,
    readPort,
  });
  return useMemo((): TaskSessionRecordsState => {
    if (workspaceId === null) {
      return { kind: "loading", loaded: null };
    }
    // Each list that was read, in task order. When every list is read, these are all records.
    const records = toTaskSessionRecords(
      sessionLists.loadedTaskIds.map((id) => ({ id })),
      sessionLists.data,
      workspaceId,
    );
    const loaded = records.taskIds.length === 0 ? null : records;
    if (sessionLists.isPending) {
      return { kind: "loading", loaded };
    }
    if (sessionLists.error) {
      return { kind: "failed", error: sessionLists.error, loaded };
    }
    return { kind: "ready", records };
  }, [
    workspaceId,
    sessionLists.data,
    sessionLists.error,
    sessionLists.isPending,
    sessionLists.loadedTaskIds,
  ]);
};
