import type { TaskCard } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { host } from "@/state/operations/host";
import { repoConfigQueryOptions, workspaceQueryKeys } from "@/state/queries/workspace";
import { addTaskToAgentStudioState } from "./agent-studio-workspace-state";

type AgentStudioStateHost = Pick<
  typeof host,
  "workspaceGetRepoConfig" | "workspaceReplaceAgentStudioState"
>;

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
  const repoConfig = await queryClient.fetchQuery({
    ...repoConfigQueryOptions(workspaceId, hostClient),
    staleTime: 0,
  });
  const state = addTaskToAgentStudioState({
    state: repoConfig.agentStudioState,
    taskId,
    tasks,
  });
  if (state === repoConfig.agentStudioState) {
    return;
  }

  const updatedRepoConfig = await hostClient.workspaceReplaceAgentStudioState(workspaceId, state);
  queryClient.setQueryData(workspaceQueryKeys.repoConfig(workspaceId), updatedRepoConfig);
};
