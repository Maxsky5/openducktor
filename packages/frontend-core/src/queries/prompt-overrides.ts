import type { RepoPromptOverrides } from "@openducktor/contracts";
import type { TaskWorkflow } from "@openducktor/workflows";
import type { QueryClient } from "@tanstack/react-query";
import { loadRepoConfigFromQuery, loadSettingsSnapshotFromQuery } from "./workspace";

export const loadEffectivePromptOverrides = async (
  workspaceId: string,
  queryClient: QueryClient,
  workflow: TaskWorkflow,
): Promise<RepoPromptOverrides> => {
  const normalizedWorkspaceId = workspaceId.trim();
  if (normalizedWorkspaceId.length === 0) {
    throw new Error("Workspace id is required to load prompt overrides.");
  }
  const [repoConfig, snapshot] = await Promise.all([
    loadRepoConfigFromQuery(queryClient, normalizedWorkspaceId),
    loadSettingsSnapshotFromQuery(queryClient),
  ]);

  return workflow.prompts.mergeOverrides({
    globalOverrides: snapshot.globalPromptOverrides,
    repoOverrides: repoConfig.promptOverrides,
  });
};
