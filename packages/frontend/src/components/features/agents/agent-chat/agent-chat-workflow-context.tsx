import { TaskSnapshotContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ResolvedTaskCard } from "@openducktor/workflows";
import { taskWorkflowContextQueryOptions } from "@openducktor/frontend-core/queries/task-workflow-context";
import { optionalWorkspaceWorkflowQueryOptions } from "@openducktor/frontend-core/queries/workflows";
import { useActiveWorkspace } from "@/state/app-state-provider";

export const ChatWorkflowContext = createContext<ResolvedTaskCard | null>(null);
export const useChatWorkflowTask = () => useContext(ChatWorkflowContext);

export const useChatToolTask = (taskId: string | null) => {
  const parent = useChatWorkflowTask();
  const workspace = useActiveWorkspace();
  const snapshot = useContext(TaskSnapshotContext);
  const inherited =
    taskId && parent?.id === taskId ? parent : snapshot?.tasks.find(({ id }) => id === taskId);
  const query = useQuery({
    ...taskWorkflowContextQueryOptions(workspace, taskId ?? ""),
    enabled: !!workspace && !!taskId && !inherited,
  });
  const workspaceQuery = useQuery({
    ...optionalWorkspaceWorkflowQueryOptions(workspace),
    enabled: !!workspace && !!taskId,
  });
  return {
    task: inherited ?? query.data,
    board: workspaceQuery.data?.context.board,
    error:
      taskId && !workspace
        ? "Select the task workspace to load its workflow."
        : (query.error?.message ?? workspaceQuery.error?.message),
  };
};
