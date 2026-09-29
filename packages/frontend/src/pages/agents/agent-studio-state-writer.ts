import type { RepoConfig, WorkspaceAgentStudioStateAction } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { host } from "@/state/operations/host";
import { workspaceQueryKeys } from "@/state/queries/workspace";

type AgentStudioStateHost = Pick<typeof host, "workspaceApplyAgentStudioStateAction">;

const pendingWrites = new WeakMap<QueryClient, Map<string, Promise<void>>>();

export const applyWorkspaceAgentStudioStateAction = ({
  queryClient,
  workspaceId,
  action,
  hostClient = host,
}: {
  queryClient: QueryClient;
  workspaceId: string;
  action: WorkspaceAgentStudioStateAction;
  hostClient?: AgentStudioStateHost;
}): Promise<RepoConfig> => {
  let workspaceWrites = pendingWrites.get(queryClient);
  if (!workspaceWrites) {
    workspaceWrites = new Map();
    pendingWrites.set(queryClient, workspaceWrites);
  }
  const previous = workspaceWrites.get(workspaceId) ?? Promise.resolve();
  const write = previous.then(async () => {
    const repoConfig = await hostClient.workspaceApplyAgentStudioStateAction(workspaceId, action);
    const queryKey = workspaceQueryKeys.repoConfig(workspaceId);
    await queryClient.cancelQueries({ queryKey, exact: true }, { revert: false });
    queryClient.setQueryData(queryKey, repoConfig);
    return repoConfig;
  });
  const settled = write.then(
    () => undefined,
    () => undefined,
  );
  workspaceWrites.set(workspaceId, settled);
  const clearSettledWrite = () => {
    if (workspaceWrites.get(workspaceId) === settled) {
      workspaceWrites.delete(workspaceId);
    }
  };
  void settled.then(clearSettledWrite);
  return write;
};
