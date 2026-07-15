import type { QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { AgentSessionReadPort } from "@/state/queries/agent-sessions";
import { useAgentSessionLists } from "@/state/queries/use-agent-session-lists";
import { type TaskSessionRecords, toTaskSessionRecords } from "./task-session-records";

export type TaskSessionRecordsState =
  | { kind: "loading" }
  | { kind: "failed"; error: unknown }
  | { kind: "ready"; records: TaskSessionRecords };

type UseTaskSessionRecordsArgs = {
  repoPath: string | null;
  taskIds: string[];
  enabled: boolean;
  queryClient: QueryClient;
  readPort: AgentSessionReadPort;
};

export const useTaskSessionRecords = ({
  repoPath,
  taskIds,
  enabled,
  queryClient,
  readPort,
}: UseTaskSessionRecordsArgs): TaskSessionRecordsState => {
  const sessionLists = useAgentSessionLists({
    repoPath,
    taskIds,
    enabled,
    queryClient,
    readPort,
  });
  return useMemo((): TaskSessionRecordsState => {
    if (sessionLists.isPending) {
      return { kind: "loading" };
    }
    if (sessionLists.error) {
      return { kind: "failed", error: sessionLists.error };
    }
    const taskSessionTargets = Object.keys(sessionLists.data).map((id) => ({ id }));
    return {
      kind: "ready",
      records: toTaskSessionRecords(taskSessionTargets, sessionLists.data),
    };
  }, [sessionLists.data, sessionLists.error, sessionLists.isPending]);
};
