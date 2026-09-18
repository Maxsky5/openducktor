import type { AgentSessionRecord } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type {
  ActiveTaskSessionContext,
  KanbanTaskSession,
} from "@/components/features/kanban/kanban-task-activity";
import {
  buildActiveTaskSessionContextByTaskId,
  buildTaskSessionsByTaskId,
} from "@/pages/kanban/use-kanban-board-model";
import { useAgentSessionSummaries } from "@/state/app-state-provider";
import { useAgentSessionLists } from "@/state/queries/use-agent-session-lists";

export type TaskDetailsSessionContext = {
  taskSessionsByTaskId: Map<string, KanbanTaskSession[]>;
  historicalSessionsByTaskId: Map<string, AgentSessionRecord[]>;
  activeTaskSessionContextByTaskId: Map<string, ActiveTaskSessionContext>;
};

type UseTaskDetailsSessionContextArgs = {
  repoPath: string | null;
  taskIds: string[];
};

export function useTaskDetailsSessionContext({
  repoPath,
  taskIds,
}: UseTaskDetailsSessionContextArgs): TaskDetailsSessionContext {
  const queryClient = useQueryClient();
  const sessions = useAgentSessionSummaries();
  const taskSessionsByTaskId = useMemo(() => buildTaskSessionsByTaskId(sessions), [sessions]);
  const activeTaskSessionContextByTaskId = useMemo(
    () => buildActiveTaskSessionContextByTaskId(sessions),
    [sessions],
  );
  const sessionLists = useAgentSessionLists({
    repoPath,
    taskIds,
    enabled: repoPath !== null && taskIds.length > 0,
    queryClient,
  });
  const historicalSessionsByTaskId = useMemo(
    () => new Map(taskIds.map((taskId) => [taskId, sessionLists.data[taskId] ?? []])),
    [sessionLists.data, taskIds],
  );

  return {
    taskSessionsByTaskId,
    historicalSessionsByTaskId,
    activeTaskSessionContextByTaskId,
  };
}
