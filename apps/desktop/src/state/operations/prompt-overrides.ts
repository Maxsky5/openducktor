import type { RepoPromptOverrides } from "@openducktor/contracts";
import { mergePromptOverrides } from "@openducktor/core";
import { appQueryClient } from "@/lib/query-client";
import { loadRepoConfigFromQuery, loadSettingsSnapshotFromQuery } from "../queries/workspace";

export const loadEffectivePromptOverrides = async (
  repoPath: string,
): Promise<RepoPromptOverrides> => {
  const normalizedRepoPath = repoPath.trim();
  const [repoConfig, snapshot] = await Promise.all([
    loadRepoConfigFromQuery(appQueryClient, normalizedRepoPath),
    loadSettingsSnapshotFromQuery(appQueryClient),
  ]);

  return mergePromptOverrides({
    globalOverrides: snapshot.globalPromptOverrides,
    repoOverrides: repoConfig.promptOverrides,
  });
};
