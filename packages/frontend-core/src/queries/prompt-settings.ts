import { promptSettingsOf, type PromptSettings } from "@openducktor/workflows";
import type { QueryClient } from "@tanstack/react-query";
import { loadRepoConfigFromQuery, loadSettingsSnapshotFromQuery } from "./workspace";

/** The saved prompt layers of the global settings and of the repository of a workspace. */
export const loadPromptSettings = async (
  workspaceId: string,
  queryClient: QueryClient,
): Promise<PromptSettings> => {
  const normalizedWorkspaceId = workspaceId.trim();
  if (normalizedWorkspaceId.length === 0) {
    throw new Error("Workspace id is required to load prompt settings.");
  }
  const [repoConfig, snapshot] = await Promise.all([
    loadRepoConfigFromQuery(queryClient, normalizedWorkspaceId),
    loadSettingsSnapshotFromQuery(queryClient),
  ]);

  return promptSettingsOf(snapshot, repoConfig);
};
