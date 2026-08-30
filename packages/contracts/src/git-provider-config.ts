import type { GitProviderConfig, GitProviderId, RepoGitConfig } from "./git-schemas";

export const selectGitProviderConfig = (
  gitConfig: RepoGitConfig | null | undefined,
  providerId: GitProviderId,
): GitProviderConfig | undefined => {
  const provider = gitConfig?.provider;
  return provider?.id === providerId ? provider : undefined;
};
