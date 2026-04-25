import type { RepoPromptOverrides } from "@openducktor/contracts";
import { mergePromptOverrides } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import { appQueryClient } from "@/lib/query-client";
import { loadRepoConfigFromQuery, loadSettingsSnapshotFromQuery } from "../../queries/workspace";

export const loadEffectivePromptOverrides = async (
  workspaceId: string,
  queryClient: QueryClient = appQueryClient,
): Promise<RepoPromptOverrides> => {
  const normalizedWorkspaceId = workspaceId.trim();
  if (normalizedWorkspaceId.length === 0) {
    throw new Error("Workspace id is required to load prompt overrides.");
  }
  const [repoConfig, snapshot] = await Promise.all([
    loadRepoConfigFromQuery(queryClient, normalizedWorkspaceId),
    loadSettingsSnapshotFromQuery(queryClient),
  ]);

  return mergePromptOverrides({
    globalOverrides: snapshot.globalPromptOverrides,
    repoOverrides: repoConfig.promptOverrides,
  });
};
