import type { RepoPromptOverrides } from "@openducktor/contracts";
import { mergePromptOverrides } from "@openducktor/core";
import { host } from "./host";

export const loadEffectivePromptOverrides = async (
  repoPath: string,
): Promise<RepoPromptOverrides> => {
  const [repoConfig, snapshot] = await Promise.all([
    host.workspaceGetRepoConfig(repoPath),
    host.workspaceGetSettingsSnapshot(),
  ]);

  return mergePromptOverrides({
    globalOverrides: snapshot.globalPromptOverrides,
    repoOverrides: repoConfig.promptOverrides,
  });
};
