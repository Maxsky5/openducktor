import type { RepositoryGitProviderContext } from "@openducktor/contracts";

export const pullRequestHealthError = (
  context: RepositoryGitProviderContext | undefined,
): string | null => {
  if (!context?.descriptor.capabilities.supportsPullRequests || context.health.available) {
    return null;
  }

  return context.health.reason ?? `${context.descriptor.label} is not available for Pull Requests.`;
};
