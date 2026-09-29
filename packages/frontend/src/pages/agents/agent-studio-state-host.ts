import type { TaskCard } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { host } from "@/state/operations/host";
import { applyWorkspaceAgentStudioStateAction } from "./agent-studio-state-writer";

type AgentStudioStateHost = Pick<typeof host, "workspaceApplyAgentStudioStateAction">;

export const addTaskToWorkspaceAgentStudioState = async ({
  queryClient,
  workspaceId,
  taskId,
  tasks,
  hostClient = host,
}: {
  queryClient: QueryClient;
  workspaceId: string;
  taskId: string;
  tasks: readonly TaskCard[];
  hostClient?: AgentStudioStateHost;
}): Promise<void> => {
  const task = tasks.find((entry) => entry.id === taskId);
  if (!task || task.status === "closed") {
    return;
  }
  await applyWorkspaceAgentStudioStateAction({
    queryClient,
    workspaceId,
    action: { type: "ensure_tab", taskId },
    hostClient,
  });
};
