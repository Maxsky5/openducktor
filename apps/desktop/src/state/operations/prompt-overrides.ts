import type { RepoPromptOverrides } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { mergePromptOverrides } from "@openducktor/core";
import { appQueryClient } from "@/lib/query-client";
import { loadRepoConfigFromQuery, loadSettingsSnapshotFromQuery } from "../queries/workspace";

export const loadEffectivePromptOverrides = async (
  repoPath: string,
  queryClient: QueryClient = appQueryClient,
): Promise<RepoPromptOverrides> => {
  const normalizedRepoPath = repoPath.trim();
  const [repoConfig, snapshot] = await Promise.all([
    loadRepoConfigFromQuery(queryClient, normalizedRepoPath),
    loadSettingsSnapshotFromQuery(queryClient),
  ]);

  return mergePromptOverrides({
    globalOverrides: snapshot.globalPromptOverrides,
    repoOverrides: repoConfig.promptOverrides,
  });
};
